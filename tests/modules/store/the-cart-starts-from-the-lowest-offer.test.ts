// @vitest-environment node
/**
 * The cart and the coupon preview start from the price the checkout charges.
 *
 * They read their basket from the database rather than through the checkout,
 * so they price it with `saleAdjustedPrice`. A running campaign and a
 * store-wide sale are both offers; the buyer gets the lowest one, the same as
 * the shelf shows and the till takes.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const sales = { current: [] as Record<string, unknown>[] };
const campaigns = { current: [] as Record<string, unknown>[] };

vi.mock("@/core/sdk/server", () => ({
    prisma: {
        storeSale: { findMany: vi.fn(async () => sales.current) },
        campaign: { findMany: vi.fn(async () => campaigns.current) },
    },
    siteTimeZone: vi.fn(async () => "UTC"),
}));

const { saleAdjustedPrice } = await import("@/modules/store/lib/store-sale-server");

const product = { id: "p1", price: 100, salePrice: null, saleFrom: null, saleUntil: null, categoryId: "c1" };

function storeWideSale(percent: number) {
    sales.current = [{
        id: "s1",
        name: "Weekend",
        percent,
        categoryIds: [],
        isActive: true,
        startsAt: new Date(Date.now() - 60_000),
        endsAt: new Date(Date.now() + 60_000),
    }];
}

function campaignAt(price: number) {
    campaigns.current = [{
        isActive: true,
        days: [],
        fromMinute: null,
        untilMinute: null,
        entries: [{ productId: "p1", price, stock: null }],
    }];
}

beforeEach(() => {
    sales.current = [];
    campaigns.current = [];
});

describe("the price the cart starts from", () => {
    it("is the list price when nothing is running", async () => {
        expect((await saleAdjustedPrice(new Date()))(product)).toBe(100);
    });

    it("is a running campaign's price", async () => {
        campaignAt(60);
        expect((await saleAdjustedPrice(new Date()))(product)).toBe(60);
    });

    it("is the store-wide sale when it is lower than the campaign", async () => {
        campaignAt(90);
        storeWideSale(20);
        expect((await saleAdjustedPrice(new Date()))(product)).toBe(80);
    });

    it("is the campaign when it is lower than the store-wide sale", async () => {
        campaignAt(60);
        storeWideSale(20);
        expect((await saleAdjustedPrice(new Date()))(product)).toBe(60);
    });
});
