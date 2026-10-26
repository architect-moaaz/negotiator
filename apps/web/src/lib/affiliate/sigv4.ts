import { createHash, createHmac } from "node:crypto";

/** The SigV4 signing key: HMAC chain over date, region, service, "aws4_request". */
export function deriveSigningKey(secretKey: string, date: string, region: string, service: string) {
  const hmac = (key: Buffer | string, s: string) => createHmac("sha256", key).update(s, "utf8").digest();
  return hmac(hmac(hmac(hmac(`AWS4${secretKey}`, date), region), service), "aws4_request");
}

/** AWS Signature Version 4 for a JSON POST (used by Amazon's Product Advertising API). */
export function signAwsRequest(input: { host: string; path: string; region: string; service: string; target: string; body: string; accessKey: string; secretKey: string; now?: Date }): Record<string, string> {
  const now = input.now ?? new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ""); // YYYYMMDDTHHMMSSZ
  const date = amzDate.slice(0, 8);
  const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

  const headers: Record<string, string> = {
    "content-encoding": "amz-1.0",
    "content-type": "application/json; charset=utf-8",
    host: input.host,
    "x-amz-date": amzDate,
    "x-amz-target": input.target,
  };
  const signedHeaders = Object.keys(headers).sort().join(";");
  const canonical = ["POST", input.path, "", ...Object.keys(headers).sort().map((k) => `${k}:${headers[k]}`), "", signedHeaders, sha(input.body)].join("\n");
  const scope = `${date}/${input.region}/${input.service}/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha(canonical)].join("\n");
  const kSigning = deriveSigningKey(input.secretKey, date, input.region, input.service);
  const signature = createHmac("sha256", kSigning).update(toSign, "utf8").digest("hex");
  return { ...headers, Authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}` };
}
