import { connectDB, disconnectDB } from '../config/db.js';
import { env } from '../config/env.js';
import { VariantModel } from '../models/variant.model.js';
import { normalizeColor, normalizeSize } from '../utils/sizes.js';

/**
 * One-off data migration: normalises `size` and `color` on existing variants to
 * the same rules the API applies on write (apparel sizes upper-cased, blank →
 * null, colours Title Cased).
 *
 * - Dry-run by default; nothing is written without `--apply`.
 * - Idempotent: a second run reports 0 changes.
 * - Collision-aware: if normalising would duplicate an existing
 *   (product, size, color) combination, that variant is skipped and reported
 *   instead of tripping the unique index.
 * - Only the `variants` collection is touched — order snapshots keep the values
 *   they captured at purchase time.
 */

interface Change {
  id: string;
  sku: string;
  from: { size: string | null; color: string | null };
  to: { size: string | null; color: string | null };
}

const comboKey = (size: string | null, color: string | null): string =>
  `${(size ?? '').toLowerCase()}|${(color ?? '').toLowerCase()}`;

const describe = (change: Change): string =>
  `${change.sku}: size ${JSON.stringify(change.from.size)} -> ${JSON.stringify(change.to.size)}, ` +
  `color ${JSON.stringify(change.from.color)} -> ${JSON.stringify(change.to.color)}`;

const main = async (): Promise<void> => {
  const apply = process.argv.includes('--apply');
  const target = env.MONGODB_URI.replace(/\/\/[^@]*@/, '//***@');

  console.log(`Target: ${target}`);
  console.log(apply ? 'Mode: APPLY (writes changes)' : 'Mode: dry-run (pass --apply to write)');

  await connectDB({ requireTransactions: false });

  const variants = await VariantModel.find().select('product sku size color').exec();
  type VariantDoc = (typeof variants)[number];

  const byProduct = new Map<string, VariantDoc[]>();
  for (const variant of variants) {
    const key = variant.product.toString();
    const bucket = byProduct.get(key);
    if (bucket) {
      bucket.push(variant);
    } else {
      byProduct.set(key, [variant]);
    }
  }

  const changes: Change[] = [];
  const collisions: Change[] = [];

  for (const bucket of byProduct.values()) {
    const occupied = new Set(bucket.map((variant) => comboKey(variant.size, variant.color)));

    for (const variant of bucket) {
      const size = normalizeSize(variant.size);
      const color = normalizeColor(variant.color);
      if (size === variant.size && color === variant.color) {
        continue;
      }

      const currentKey = comboKey(variant.size, variant.color);
      const nextKey = comboKey(size, color);
      const change: Change = {
        id: variant._id.toString(),
        sku: variant.sku,
        from: { size: variant.size, color: variant.color },
        to: { size, color },
      };

      if (nextKey !== currentKey && occupied.has(nextKey)) {
        collisions.push(change);
        continue;
      }

      occupied.delete(currentKey);
      occupied.add(nextKey);
      changes.push(change);
    }
  }

  console.log(`Scanned ${variants.length} variant(s) across ${byProduct.size} product(s).`);
  console.log(`${changes.length} variant(s) need normalisation.`);
  for (const change of changes.slice(0, 10)) {
    console.log(`  ${describe(change)}`);
  }
  if (changes.length > 10) {
    console.log(`  …and ${changes.length - 10} more.`);
  }

  if (collisions.length > 0) {
    console.log(`${collisions.length} variant(s) skipped — normalising would duplicate a size/color:`);
    for (const collision of collisions) {
      console.log(`  ${describe(collision)}`);
    }
  }

  if (!apply) {
    console.log('No changes written. Re-run with --apply to update these variants.');
  } else if (changes.length === 0) {
    console.log('Nothing to write.');
  } else {
    const result = await VariantModel.bulkWrite(
      changes.map((change) => ({
        updateOne: {
          filter: { _id: change.id },
          update: { $set: { size: change.to.size, color: change.to.color } },
        },
      })),
    );
    console.log(`Updated ${result.modifiedCount} variant(s).`);
  }

  await disconnectDB();
};

main().catch(async (error) => {
  console.error('normalize-variants failed:', error instanceof Error ? error.message : error);
  await disconnectDB().catch(() => undefined);
  process.exitCode = 1;
});
