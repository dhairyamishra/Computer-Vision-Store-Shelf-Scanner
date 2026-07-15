import type { PGlite } from "@electric-sql/pglite";

type AccountSeed = {
  id: string;
  name: string;
  externalIdentifier: string;
  region: string;
};

const accounts: AccountSeed[] = [
  {
    id: "account-northside-market",
    name: "Northside Market",
    externalIdentifier: "northside-market-001",
    region: "New York",
  },
  {
    id: "account-riverside-grocer",
    name: "Riverside Grocer",
    externalIdentifier: "riverside-grocer-001",
    region: "New York",
  },
];

const products = [
  {
    id: "product-sparkling-water-lime-12oz",
    brand: "Clear Spring",
    product: "Sparkling Water",
    variant: "Lime",
    size: "12 oz",
    pack: null,
    aliases: ["Clear Spring Lime", "Lime Sparkling Water"],
  },
  {
    id: "product-sparkling-water-berry-12oz",
    brand: "Clear Spring",
    product: "Sparkling Water",
    variant: "Berry",
    size: "12 oz",
    pack: null,
    aliases: ["Clear Spring Berry", "Berry Sparkling Water"],
  },
  {
    id: "product-mineral-water-plain-1l",
    brand: "Mountain Well",
    product: "Mineral Water",
    variant: "Plain",
    size: "1 L",
    pack: null,
    aliases: ["Mountain Well 1L"],
  },
] as const;

const assortments = [
  {
    accountId: "account-northside-market",
    productId: "product-sparkling-water-lime-12oz",
    expectedFacings: 3,
    expectedShelfPosition: "eye_level",
    expectedPriceCents: 149,
  },
  {
    accountId: "account-northside-market",
    productId: "product-sparkling-water-berry-12oz",
    expectedFacings: 2,
    expectedShelfPosition: "eye_level",
    expectedPriceCents: 149,
  },
  {
    accountId: "account-riverside-grocer",
    productId: "product-mineral-water-plain-1l",
    expectedFacings: 2,
    expectedShelfPosition: "waist_level",
    expectedPriceCents: 199,
  },
] as const;

export async function seedDemoData(database: PGlite): Promise<void> {
  await database.transaction(async (transaction) => {
    for (const account of accounts) {
      await transaction.query(
        `INSERT INTO accounts (id, name, external_identifier, region)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO NOTHING`,
        [account.id, account.name, account.externalIdentifier, account.region],
      );
    }

    for (const product of products) {
      await transaction.query(
        `INSERT INTO products (id, brand, product, variant, size, pack, aliases)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
         ON CONFLICT (id) DO NOTHING`,
        [
          product.id,
          product.brand,
          product.product,
          product.variant,
          product.size,
          product.pack,
          JSON.stringify(product.aliases),
        ],
      );
    }

    for (const assortment of assortments) {
      await transaction.query(
        `INSERT INTO account_assortments
          (account_id, product_id, expected_presence, expected_facings, expected_shelf_position, expected_price_cents)
         VALUES ($1, $2, TRUE, $3, $4, $5)
         ON CONFLICT (account_id, product_id) DO NOTHING`,
        [
          assortment.accountId,
          assortment.productId,
          assortment.expectedFacings,
          assortment.expectedShelfPosition,
          assortment.expectedPriceCents,
        ],
      );
    }
  });
}
