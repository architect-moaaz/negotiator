import { describe, expect, it } from "vitest";
import { askSupport, cancelOrder, confirm, init, issueState, issueStatusRequest, orderState, raiseIssue, refreshStatus, requestReturn, search, searchResults, select, supportResult, trackOrder, trackResult } from "./buyer";

const delivery = { name: "ZZ Buyer", phone: "9000006001", building: "12 ZZ Residency", locality: "Indiranagar", city: "Bengaluru", state: "Karnataka", pincode: "560038" };

async function placed(user: string) {
  const { transactionId } = await search("kettle", user);
  const kettle = (await searchResults(transactionId)).find((i) => i.itemId === "zz-ondc-kettle")!;
  const pick = { bppId: kettle.bppId, providerId: kettle.providerId, itemId: kettle.itemId, quantity: 1, pincode: "560038" };
  await select(transactionId, pick, user);
  await init(transactionId, pick, delivery, user);
  await confirm(transactionId, user);
  return transactionId;
}

describe("ONDC after the order", () => {
  it("refreshes status, tracks, gets seller support, and cancels with a network reason code", async () => {
    const txn = await placed("zz-after-a");
    await refreshStatus(txn, "zz-after-a");
    expect(await orderState(txn)).toMatchObject({ state: "In-progress", fulfillmentState: "Order-picked-up" });
    await trackOrder(txn, "zz-after-a");
    expect(await trackResult(txn)).toMatchObject({ status: "active", url: expect.stringContaining("/track/") });
    await askSupport(txn, "zz-after-a");
    expect(await supportResult(txn)).toMatchObject({ phone: "+919000000999", email: "zz-support@mock-seller.test" });
    await expect(cancelOrder(txn, "999", "zz-after-a")).rejects.toThrow("reason");
    await cancelOrder(txn, "006", "zz-after-a");
    expect(await orderState(txn)).toMatchObject({ state: "Cancelled", fulfillmentState: "Cancelled" });
  });

  it("requests a return and raises an IGM issue through to resolution", async () => {
    const txn = await placed("zz-after-b");
    await expect(requestReturn(txn, "no", "zz-after-b")).rejects.toThrow();
    await requestReturn(txn, "Lid doesn't close properly", "zz-after-b");
    expect(await orderState(txn)).toMatchObject({ fulfillmentState: "Return_Initiated" });

    await expect(raiseIssue(txn, { type: "ITM04", description: "short", name: "ZZ", phone: "9000006001" })).rejects.toThrow();
    const { issueId } = await raiseIssue(txn, { type: "ITM04", description: "The kettle leaks from the base after one use.", name: "ZZ Buyer", phone: "9000006001" }, "zz-after-b");
    expect(await issueState(txn)).toMatchObject({ id: issueId, status: "OPEN", lastAction: "PROCESSING" });
    await issueStatusRequest(txn, issueId, "zz-after-b");
    expect(await issueState(txn)).toMatchObject({ status: "CLOSED", lastAction: "RESOLVED", resolution: "Refunded the item", refund: "899.00" });
  });

  it("refuses after-order actions before there's a confirmed order", async () => {
    const { transactionId } = await search("kettle", "zz-after-c");
    await expect(trackOrder(transactionId, "zz-after-c")).rejects.toThrow("no confirmed order");
  });
});
