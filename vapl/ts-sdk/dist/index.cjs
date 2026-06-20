"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  base58btcDecode: () => base58btcDecode,
  base58btcEncode: () => base58btcEncode,
  base64urlToBytes: () => base64urlToBytes,
  bytesToBase64url: () => bytesToBase64url,
  computeReputationScore: () => computeReputationScore,
  createPresentation: () => createPresentation,
  didToPublicKey: () => didToPublicKey,
  exportSoul: () => exportSoul,
  generateKeypair: () => generateKeypair,
  generateProvenanceSoulManifest: () => generateProvenanceSoulManifest,
  generateSoul: () => generateSoul,
  issueAccuracyVC: () => issueAccuracyVC,
  issueContributionVC: () => issueContributionVC,
  issueInteractionVC: () => issueInteractionVC,
  issueVC: () => issueVC,
  issueX402InteractionVC: () => issueX402InteractionVC,
  loadSoul: () => loadSoul,
  matchProviders: () => matchProviders,
  parseVaplHeaders: () => parseVaplHeaders,
  publicKeyToDid: () => publicKeyToDid,
  rankAgents: () => rankAgents,
  resolveDid: () => resolveDid,
  sign: () => sign,
  vaplResponseHeaders: () => vaplResponseHeaders,
  verify: () => verify,
  verifyVC: () => verifyVC,
  verifyVCBatch: () => verifyVCBatch
});
module.exports = __toCommonJS(index_exports);

// src/identity/keypair.ts
var import_ed25519 = require("@noble/curves/ed25519");
function generateKeypair() {
  const privateKey = import_ed25519.ed25519.utils.randomPrivateKey();
  const publicKey = import_ed25519.ed25519.getPublicKey(privateKey);
  return { publicKey, privateKey };
}
function sign(message, privateKey) {
  return import_ed25519.ed25519.sign(message, privateKey);
}
function verify(message, signature, publicKey) {
  try {
    return import_ed25519.ed25519.verify(signature, message, publicKey);
  } catch {
    return false;
  }
}
function bytesToBase64url(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i] ?? 0);
  }
  if (typeof btoa !== "undefined") {
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  }
  return Buffer.from(bytes).toString("base64url");
}
function base64urlToBytes(base64url) {
  if (typeof atob !== "undefined") {
    const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(base64.length + (4 - base64.length % 4) % 4, "=");
    const binary = atob(padded);
    return new Uint8Array(binary.split("").map((c) => c.charCodeAt(0)));
  }
  return new Uint8Array(Buffer.from(base64url, "base64url"));
}

// src/identity/encoding.ts
var BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58btcEncode(bytes) {
  let leadingZeros = 0;
  for (const byte of bytes) {
    if (byte === 0) leadingZeros++;
    else break;
  }
  let num = BigInt(0);
  for (const byte of bytes) {
    num = num * BigInt(256) + BigInt(byte);
  }
  let result = "";
  while (num > BigInt(0)) {
    const remainder = Number(num % BigInt(58));
    result = (BASE58_ALPHABET[remainder] ?? "") + result;
    num = num / BigInt(58);
  }
  return "1".repeat(leadingZeros) + result;
}
function base58btcDecode(s) {
  let num = BigInt(0);
  let leadingZeros = 0;
  for (const char of s) {
    if (char === "1" && num === BigInt(0)) {
      leadingZeros++;
      continue;
    }
    const index = BASE58_ALPHABET.indexOf(char);
    if (index === -1) throw new Error(`Invalid base58 character: ${char}`);
    num = num * BigInt(58) + BigInt(index);
  }
  const bytes = [];
  while (num > BigInt(0)) {
    bytes.unshift(Number(num % BigInt(256)));
    num = num / BigInt(256);
  }
  return new Uint8Array([...new Array(leadingZeros).fill(0), ...bytes]);
}

// src/identity/did.ts
var ED25519_MULTICODEC = new Uint8Array([237, 1]);
function publicKeyToDid(publicKey) {
  const prefixed = new Uint8Array(ED25519_MULTICODEC.length + publicKey.length);
  prefixed.set(ED25519_MULTICODEC);
  prefixed.set(publicKey, ED25519_MULTICODEC.length);
  return `did:key:z${base58btcEncode(prefixed)}`;
}
function didToPublicKey(did) {
  if (!did.startsWith("did:key:z")) {
    throw new Error(`Invalid did:key format: ${did}`);
  }
  const multibaseKey = did.slice("did:key:".length);
  const decoded = base58btcDecode(multibaseKey.slice(1));
  if (decoded[0] !== 237 || decoded[1] !== 1) {
    throw new Error("Expected Ed25519 multicodec prefix 0xed01");
  }
  return decoded.slice(2);
}
function resolveDid(did) {
  const publicKey = didToPublicKey(did);
  const keyId = did.slice("did:key:".length);
  const vmId = `${did}#${keyId}`;
  const document = {
    "@context": [
      "https://www.w3.org/ns/did/v1",
      "https://w3id.org/security/suites/ed25519-2020/v1"
    ],
    id: did,
    verificationMethod: [{
      id: vmId,
      type: "Ed25519VerificationKey2020",
      controller: did,
      publicKeyMultibase: keyId
    }],
    authentication: [vmId],
    assertionMethod: [vmId],
    capabilityDelegation: [vmId],
    capabilityInvocation: [vmId]
  };
  return { did, document, verificationMethodId: vmId, publicKey };
}

// src/identity/soul.ts
var ED25519_MULTICODEC2 = new Uint8Array([237, 1]);
function generateSoul() {
  const { publicKey, privateKey } = generateKeypair();
  const did = publicKeyToDid(publicKey);
  const { verificationMethodId } = resolveDid(did);
  const prefixed = new Uint8Array(ED25519_MULTICODEC2.length + publicKey.length);
  prefixed.set(ED25519_MULTICODEC2);
  prefixed.set(publicKey, ED25519_MULTICODEC2.length);
  const publicKeyMultibase = "z" + base58btcEncode(prefixed);
  return {
    did,
    verificationMethodId,
    publicKey,
    privateKey,
    publicKeyMultibase,
    createdAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function exportSoul(soul) {
  return {
    did: soul.did,
    verificationMethodId: soul.verificationMethodId,
    publicKeyMultibase: soul.publicKeyMultibase,
    privateKeyBase64url: bytesToBase64url(soul.privateKey),
    publicKeyBase64url: bytesToBase64url(soul.publicKey),
    createdAt: soul.createdAt
  };
}
function loadSoul(stored) {
  return {
    did: stored.did,
    verificationMethodId: stored.verificationMethodId,
    publicKeyMultibase: stored.publicKeyMultibase,
    publicKey: base64urlToBytes(stored.publicKeyBase64url),
    privateKey: base64urlToBytes(stored.privateKeyBase64url),
    createdAt: stored.createdAt
  };
}

// src/credentials/issuer.ts
var import_sha256 = require("@noble/hashes/sha256");

// src/credentials/schema.ts
var VAPL_CONTEXT = "https://vapl.scriptmasterlabs.com/v1/context.jsonld";
var VC_CONTEXT_V2 = "https://www.w3.org/ns/credentials/v2";

// src/credentials/issuer.ts
function canonicalJson(obj) {
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return "[" + obj.map(canonicalJson).join(",") + "]";
  const keys = Object.keys(obj).sort();
  return "{" + keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",") + "}";
}
function randomBase64url(bytes) {
  const arr = new Uint8Array(bytes);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(arr);
  } else {
    const { randomFillSync } = require("crypto");
    randomFillSync(arr);
  }
  return bytesToBase64url(arr);
}
function generateCredentialId(issuerDid) {
  return `urn:vapl:vc:${issuerDid.slice(-8)}:${Date.now()}:${randomBase64url(8)}`;
}
function hashDocument(doc) {
  return (0, import_sha256.sha256)(new TextEncoder().encode(canonicalJson(doc)));
}
function issueVC(soul, subjectDid, credentialType, claim, validitySeconds = 86400 * 365) {
  const now = /* @__PURE__ */ new Date();
  const validFrom = now.toISOString();
  const validUntil = new Date(now.getTime() + validitySeconds * 1e3).toISOString();
  const vcWithoutProof = {
    "@context": [VC_CONTEXT_V2, VAPL_CONTEXT],
    id: generateCredentialId(soul.did),
    type: ["VerifiableCredential", credentialType],
    issuer: soul.did,
    validFrom,
    validUntil,
    credentialSubject: { id: subjectDid, ...claim }
  };
  const hash = hashDocument(vcWithoutProof);
  const signature = sign(hash, soul.privateKey);
  const proof = {
    type: "DataIntegrityProof",
    cryptosuite: "eddsa-vapl-2024",
    created: now.toISOString(),
    verificationMethod: soul.verificationMethodId,
    proofPurpose: "assertionMethod",
    nonce: randomBase64url(16),
    proofValue: bytesToBase64url(signature)
  };
  return { ...vcWithoutProof, proof };
}
function issueInteractionVC(soul, subjectDid, interaction) {
  return issueVC(soul, subjectDid, "InteractionCredential", {
    interaction: { ...interaction, nonce: randomBase64url(8) }
  });
}
function issueAccuracyVC(soul, subjectDid, accuracy) {
  return issueVC(soul, subjectDid, "AccuracyCredential", {
    accuracy: { ...accuracy, nonce: randomBase64url(8) }
  });
}
function issueContributionVC(soul, subjectDid, contribution) {
  return issueVC(soul, subjectDid, "ContributionCredential", {
    contribution: { ...contribution, nonce: randomBase64url(8) }
  });
}

// src/credentials/verifier.ts
var import_sha2562 = require("@noble/hashes/sha256");
var CLOCK_SKEW_MS = 5 * 60 * 1e3;
function canonicalJson2(obj) {
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return "[" + obj.map(canonicalJson2).join(",") + "]";
  const keys = Object.keys(obj).sort();
  return "{" + keys.map((k) => `${JSON.stringify(k)}:${canonicalJson2(obj[k])}`).join(",") + "}";
}
function verifyVC(credential, options = {}) {
  const now = options.now ?? /* @__PURE__ */ new Date();
  const errors = [];
  const warnings = [];
  if (!credential["@context"]?.includes(VC_CONTEXT_V2)) errors.push("Missing W3C VC v2 context");
  if (!credential.type?.includes("VerifiableCredential")) errors.push("Missing VerifiableCredential type");
  if (!credential.issuer) errors.push("Missing issuer");
  if (!credential.proof) errors.push("Missing proof");
  if (!credential.credentialSubject?.id) errors.push("Missing credentialSubject.id");
  if (errors.length > 0) return { valid: false, errors, warnings, verifiedAt: now.toISOString() };
  if (options.trustedIssuers && !options.trustedIssuers.includes(credential.issuer)) {
    errors.push(`Issuer ${credential.issuer} is not in trusted issuers list`);
  }
  if (!credential.issuer.startsWith("did:key:")) {
    errors.push("Issuer must be a did:key DID");
  }
  const proof = credential.proof;
  if (proof.type !== "DataIntegrityProof") errors.push(`Unsupported proof type: ${proof.type}`);
  if (proof.cryptosuite !== "eddsa-vapl-2024") errors.push(`Unsupported cryptosuite: ${proof.cryptosuite}`);
  if (proof.proofPurpose !== "assertionMethod") errors.push(`Unexpected proofPurpose: ${proof.proofPurpose}`);
  if (!proof.verificationMethod.startsWith(credential.issuer)) {
    errors.push("Verification method does not match issuer DID");
  }
  if (errors.length > 0) return { valid: false, errors, warnings, verifiedAt: now.toISOString() };
  if (options.checkExpiry !== false) {
    const validFrom = new Date(credential.validFrom);
    if (validFrom.getTime() > now.getTime() + CLOCK_SKEW_MS) {
      errors.push(`Credential not yet valid (validFrom: ${credential.validFrom})`);
    }
    if (credential.validUntil) {
      const validUntil = new Date(credential.validUntil);
      if (validUntil.getTime() < now.getTime() - CLOCK_SKEW_MS) {
        errors.push(`Credential expired (validUntil: ${credential.validUntil})`);
      }
    }
  }
  if (errors.length > 0) return { valid: false, errors, warnings, verifiedAt: now.toISOString() };
  try {
    const publicKey = didToPublicKey(credential.issuer);
    const { proof: _proof, ...vcWithoutProof } = credential;
    const hash = (0, import_sha2562.sha256)(new TextEncoder().encode(canonicalJson2(vcWithoutProof)));
    const sig = base64urlToBytes(proof.proofValue);
    if (!verify(hash, sig, publicKey)) {
      errors.push("Invalid signature: credential has been tampered with");
    }
  } catch (e) {
    errors.push(`Signature verification error: ${e instanceof Error ? e.message : String(e)}`);
  }
  const valid = errors.length === 0;
  return {
    valid,
    ...valid ? { credential } : {},
    errors,
    warnings,
    issuerDid: credential.issuer,
    subjectDid: credential.credentialSubject.id,
    verifiedAt: now.toISOString()
  };
}
function verifyVCBatch(credentials, options = {}) {
  const valid = [];
  const invalid = [];
  for (const vc of credentials) {
    const result = verifyVC(vc, options);
    if (result.valid && result.credential) {
      valid.push(result.credential);
    } else {
      invalid.push({ vc, errors: result.errors });
    }
  }
  return { valid, invalid };
}

// src/reputation/scorer.ts
var DEFAULT_WEIGHTS = {
  accuracy: 0.4,
  reliability: 0.3,
  contribution: 0.2,
  tenure: 0.1
};
function timeDecayWeight(timestamp, now, halfLifeDays) {
  const ageDays = (now.getTime() - new Date(timestamp).getTime()) / 864e5;
  return Math.pow(0.5, ageDays / halfLifeDays);
}
function computeReputationScore(credentials, subjectDid, options = {}) {
  const now = options.now ?? /* @__PURE__ */ new Date();
  const halfLife = options.decayHalfLifeDays ?? 30;
  const w = { ...DEFAULT_WEIGHTS, ...options.weights };
  const totalW = w.accuracy + w.reliability + w.contribution + w.tenure;
  const nw = {
    accuracy: w.accuracy / totalW,
    reliability: w.reliability / totalW,
    contribution: w.contribution / totalW,
    tenure: w.tenure / totalW
  };
  const { valid: validVCs, invalid } = verifyVCBatch(credentials, {
    ...options.trustedIssuers !== void 0 ? { trustedIssuers: options.trustedIssuers } : {},
    checkExpiry: false,
    now
  });
  const subjectVCs = validVCs.filter((vc) => vc.credentialSubject.id === subjectDid);
  const interactions = [];
  const accuracyClaims = [];
  const contributions = [];
  let firstSeen = null;
  let lastSeen = null;
  for (const vc of subjectVCs) {
    const ts = new Date(vc.validFrom);
    if (!firstSeen || ts < firstSeen) firstSeen = ts;
    if (!lastSeen || ts > lastSeen) lastSeen = ts;
    const subj = vc.credentialSubject;
    if (subj["interaction"]) interactions.push({ claim: subj["interaction"], timestamp: vc.validFrom });
    if (subj["accuracy"]) accuracyClaims.push(subj["accuracy"]);
    if (subj["contribution"]) contributions.push(subj["contribution"]);
  }
  const accuracyScore = accuracyClaims.length > 0 ? accuracyClaims.reduce((s, c) => s + Math.min(1, Math.max(0, c.accuracyScore)), 0) / accuracyClaims.length : 0;
  let reliabilityScore = 0;
  if (interactions.length > 0) {
    let wSuccess = 0, wTotal = 0;
    for (const { claim, timestamp } of interactions) {
      const dw = timeDecayWeight(timestamp, now, halfLife);
      const s = claim.outcome === "success" ? 1 : claim.outcome === "partial" ? 0.5 : 0;
      wSuccess += dw * s;
      wTotal += dw;
    }
    reliabilityScore = wTotal > 0 ? wSuccess / wTotal : 0;
  }
  let contributionScore = 0;
  if (contributions.length > 0) {
    const typeW = {
      MarketplaceListing: 1,
      DataContribution: 1.5,
      RelayNode: 2,
      AlphaMeshNode: 2
    };
    const weighted = contributions.reduce((s, c) => s + (typeW[c.contributionType] ?? 1), 0);
    contributionScore = Math.min(1, Math.log10(1 + weighted) / 2);
  }
  const tenureScore = firstSeen ? Math.min(1, Math.log(1 + (now.getTime() - firstSeen.getTime()) / 864e5) / Math.log(366)) : 0;
  const overall = nw.accuracy * accuracyScore + nw.reliability * reliabilityScore + nw.contribution * contributionScore + nw.tenure * tenureScore;
  const round = (n) => Math.round(n * 1e3) / 1e3;
  return {
    overall: round(overall),
    components: {
      accuracy: round(accuracyScore),
      reliability: round(reliabilityScore),
      contribution: round(contributionScore),
      tenure: round(tenureScore)
    },
    evidence: {
      totalInteractions: interactions.length,
      successfulInteractions: interactions.filter((i) => i.claim.outcome === "success").length,
      verifiedPredictions: accuracyClaims.length,
      accuratePredictions: accuracyClaims.filter((c) => c.accuracyScore >= 0.7).length,
      contributions: contributions.length,
      firstSeenTimestamp: firstSeen?.toISOString() ?? null,
      lastSeenTimestamp: lastSeen?.toISOString() ?? null
    },
    computedAt: now.toISOString(),
    credentialCount: credentials.length,
    invalidCredentials: invalid.length
  };
}
function rankAgents(agents, options = {}) {
  return agents.map((a) => ({ did: a.did, score: computeReputationScore(a.credentials, a.did, options) })).sort((a, b) => b.score.overall - a.score.overall);
}

// src/discovery/manifest.ts
function generateProvenanceSoulManifest(did, publicKeyMultibase, credentials, capabilities = [], options = {}) {
  const score = computeReputationScore(
    credentials,
    did,
    options.trustedIssuers !== void 0 ? { trustedIssuers: options.trustedIssuers } : {}
  );
  return {
    "@context": [
      "https://www.w3.org/ns/credentials/v2",
      "https://vapl.scriptmasterlabs.com/v1/context.jsonld"
    ],
    id: `${did}#soul`,
    type: "ProvenanceSoul",
    controller: did,
    publicKeyMultibase,
    reputationScore: score.overall,
    reputationComponents: score.components,
    credentialCount: score.credentialCount,
    capabilities,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function matchProviders(providers, requiredCapability, options = {}) {
  const eligible = requiredCapability ? providers.filter((p) => p.capabilities.includes(requiredCapability)) : providers;
  return eligible.map((p) => ({
    did: p.did,
    ...p.endpoint !== void 0 ? { endpoint: p.endpoint } : {},
    capabilities: p.capabilities,
    reputationScore: computeReputationScore(
      p.credentials,
      p.did,
      options.trustedIssuers !== void 0 ? { trustedIssuers: options.trustedIssuers } : {}
    )
  })).sort((a, b) => b.reputationScore.overall - a.reputationScore.overall);
}

// src/integration/x402.ts
function issueX402InteractionVC(issuerSoul, agentDid, context) {
  return issueInteractionVC(issuerSoul, agentDid, {
    type: context.type,
    resource: context.resource,
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    outcome: context.outcome,
    ...context.paymentTxHash && { paymentTxHash: context.paymentTxHash },
    ...context.paymentAmount && { paymentAmount: context.paymentAmount },
    ...context.paymentCurrency && { paymentCurrency: context.paymentCurrency },
    ...context.outcomeHash && { outcomeHash: context.outcomeHash },
    ...context.verifiableAccuracy !== void 0 && { verifiableAccuracy: context.verifiableAccuracy }
  });
}
function createPresentation(holderDid, credentials, challenge, domain) {
  return {
    "@context": [
      "https://www.w3.org/ns/credentials/v2",
      "https://vapl.scriptmasterlabs.com/v1/context.jsonld"
    ],
    type: ["VerifiablePresentation"],
    holder: holderDid,
    verifiableCredential: credentials,
    challenge,
    domain,
    presentedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function vaplResponseHeaders(vc) {
  return {
    "X-VAPL-VC": JSON.stringify(vc),
    "X-VAPL-Issuer": vc.issuer,
    "X-VAPL-VC-ID": vc.id
  };
}
function parseVaplHeaders(headers) {
  const raw = headers["x-vapl-vc"] ?? headers["X-VAPL-VC"];
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  base58btcDecode,
  base58btcEncode,
  base64urlToBytes,
  bytesToBase64url,
  computeReputationScore,
  createPresentation,
  didToPublicKey,
  exportSoul,
  generateKeypair,
  generateProvenanceSoulManifest,
  generateSoul,
  issueAccuracyVC,
  issueContributionVC,
  issueInteractionVC,
  issueVC,
  issueX402InteractionVC,
  loadSoul,
  matchProviders,
  parseVaplHeaders,
  publicKeyToDid,
  rankAgents,
  resolveDid,
  sign,
  vaplResponseHeaders,
  verify,
  verifyVC,
  verifyVCBatch
});
