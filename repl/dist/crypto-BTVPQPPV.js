// src/catalog/crypto.ts
import { createHash, randomBytes as nodeRandomBytes, randomUUID } from "crypto";
var cryptoModule = {
  id: "crypto",
  description: "Cryptographic utilities",
  functions: [
    {
      name: "hash",
      description: "Hash a string",
      signature: "(data: string, algorithm?: 'sha256' | 'sha512' | 'md5') => string",
      fn: (data, algorithm) => {
        const algo = algorithm || "sha256";
        return createHash(algo).update(data).digest("hex");
      }
    },
    {
      name: "randomBytes",
      description: "Random hex string",
      signature: "(length: number) => string",
      fn: (length) => nodeRandomBytes(length).toString("hex")
    },
    {
      name: "uuid",
      description: "Generate UUID v4",
      signature: "() => string",
      fn: () => randomUUID()
    },
    {
      name: "base64Encode",
      description: "Encode to base64",
      signature: "(data: string) => string",
      fn: (data) => Buffer.from(data).toString("base64")
    },
    {
      name: "base64Decode",
      description: "Decode from base64",
      signature: "(data: string) => string",
      fn: (data) => Buffer.from(data, "base64").toString("utf-8")
    }
  ]
};
var crypto_default = cryptoModule;
export {
  crypto_default as default
};
