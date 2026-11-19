import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Db } from '../db/db.service';
import { MarketService } from '../market/market.service';

export type VariantInput = { id?: string; label: string; options?: Record<string, string>; priceMinor?: number | null; stock?: number | null };

@Injectable()
export class VariantsService {
  constructor(private db: Db, private market: MarketService) {}

  /** Replace the product's options with this list. Ones left out are switched off (past orders keep pointing at them). */
  async replace(merchantId: string, productId: string, variants: VariantInput[]) {
    const owned = await this.db.one(`select 1 from products where id = $1 and merchant_id = $2`, [productId, merchantId]);
    if (!owned) throw new NotFoundException('Product not found');
    const labels = variants.map((v) => v.label.trim().toLowerCase());
    if (new Set(labels).size !== labels.length) throw new BadRequestException('Two options have the same name');
    await this.db.tx(async (tx) => {
      const keep: string[] = [];
      for (const [i, v] of variants.entries()) {
        if (v.id) {
          const r = await tx.query(
            `update product_variants set label=$3, options=$4, price_minor=$5, stock=$6, position=$7, active=true where id=$1 and product_id=$2 returning id`,
            [v.id, productId, v.label.trim(), JSON.stringify(v.options ?? {}), v.priceMinor ?? null, v.stock ?? null, i]);
          if (!r.length) throw new BadRequestException('One of the options does not belong to this product');
          keep.push(v.id);
        } else {
          const [r] = await tx.query(
            `insert into product_variants (product_id, label, options, price_minor, stock, position) values ($1,$2,$3,$4,$5,$6) returning id`,
            [productId, v.label.trim(), JSON.stringify(v.options ?? {}), v.priceMinor ?? null, v.stock ?? null, i]);
          keep.push(r.id);
        }
      }
      await tx.query(`update product_variants set active = false where product_id = $1 and not (id = any($2::uuid[]))`, [productId, keep]);
      // Carts holding a switched-off option would be stuck; drop them.
      await tx.query(`delete from cart_items where product_id = $1 and variant_id is not null and not (variant_id = any($2::uuid[]))`, [productId, keep]);
    });
    return this.market.get(productId, merchantId);
  }
}
