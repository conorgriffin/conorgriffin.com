import type { ReactNode } from "react";
import { PageIntro, Part, TesseraLayout, paths } from "./Layout";

const C = ({ children }: { children: ReactNode }) => <code className="text-foreground">{children}</code>;

/** A coloured segment of the example token. */
const Seg = ({ tone, children }: { tone: "header" | "payload" | "signature"; children: ReactNode }) => {
  const colour = { header: "text-[#c2185b] dark:text-[#f06292]", payload: "text-[#5e35b1] dark:text-[#9575cd]", signature: "text-[#00796b] dark:text-[#4db6ac]" }[tone];
  return <span className={colour}>{children}</span>;
};

const claims: [string, string, string][] = [
  ["iss", "Issuer", "Who created and signed the token, usually the sign-in server's URL. Use it to find the right keys, never as proof on its own."],
  ["sub", "Subject", "Who or what the token is about: a user or a service ID, unique within the issuer."],
  ["aud", "Audience", "Who the token is for. A string or an array. A service should reject any token that doesn't name it."],
  ["exp", "Expires", "Seconds since 1970 after which the token must be rejected."],
  ["nbf", "Not before", "Seconds since 1970 before which the token must be rejected."],
  ["iat", "Issued at", "When the token was created. Useful for spotting tokens that live too long."],
  ["jti", "Token ID", "A unique ID for this token, so a service can refuse to accept the same one twice."],
];

const pitfalls: { id: string; title: string; body: ReactNode }[] = [
  {
    id: "unsigned",
    title: "Unsigned tokens (alg: none)",
    body: <>A token whose header says <C>"alg": "none"</C> has no signature, so anyone can write one. Libraries that honour <C>none</C> by default have let attackers sign themselves in. Never accept it outside tests.</>,
  },
  {
    id: "expiry",
    title: "Missing or long expiry",
    body: <>Without <C>exp</C>, a leaked token works forever. Access tokens usually last minutes to an hour. Check <C>nbf</C> and <C>iat</C> too: values in the future often mean a clock is wrong, and values in milliseconds instead of seconds are a common bug.</>,
  },
  {
    id: "audience",
    title: "Missing or unchecked audience",
    body: <>If a token has no <C>aud</C>, or the service doesn't check it, a token issued for one API can be replayed against another that trusts the same issuer. Each service should accept only tokens that name it. When <C>aud</C> is an array, it's enough for one entry to match.</>,
  },
  {
    id: "weak-secrets",
    title: "Weak or published HMAC secrets",
    body: <>HS256, HS384 and HS512 use one shared secret to sign and verify. A short secret can be guessed offline from a single token, and secrets copied from tutorials are in every wordlist. Use at least as many random bytes as the hash size (32 for HS256).</>,
  },
  {
    id: "algorithm-confusion",
    title: "Algorithm confusion",
    body: <>If a verifier lets the token pick its algorithm, an attacker can take an RSA public key, which is public, and use it as an HMAC secret. Always decide the algorithm from the key you hold, not from the token's header. Tessera only uses a key with the algorithm it was made for.</>,
  },
  {
    id: "remote-keys",
    title: "Keys and key URLs in the header",
    body: <>The <C>jku</C>, <C>x5u</C>, <C>jwk</C> and <C>x5c</C> header parameters let a token point to, or carry, the key that verifies it. Trusting them blindly means trusting the attacker's key. Only use them when the key or certificate chain leads back to something you already trust.</>,
  },
  {
    id: "jwe-algorithms",
    title: "Weak JWE key management",
    body: <><C>RSA1_5</C> is open to padding-oracle attacks, so prefer <C>RSA-OAEP-256</C> or ECDH-ES. PBES2 derives a key from a password, and a low iteration count (<C>p2c</C>) makes that password quick to guess.</>,
  },
  {
    id: "hidden-characters",
    title: "Hidden characters and duplicate keys",
    body: <>Unicode text-direction controls can make a claim read differently from what it contains, and JSON with the same key twice is read differently by different parsers. Tessera shows both instead of hiding them.</>,
  },
];

export function LearnPage() {
  return (
    <TesseraLayout current="learn">
      <div className="mx-auto max-w-2xl pb-24">
        <PageIntro title="What is a JWT?" subtitle="Learn">
          <p className="mt-6 text-lg leading-relaxed text-muted-foreground">
            A short introduction to JSON Web Tokens, how they're signed and encrypted, and the mistakes that make them unsafe.
          </p>
        </PageIntro>

        <Part title="A token you can check without a database" id="what-is-a-jwt">
          <p>
            A JSON Web Token (JWT, said “jot”) is a compact way to send a set of facts, called claims, that the receiver can check without asking anyone. A sign-in server issues one after you log in, and every API you call can confirm it's genuine using only a key.
          </p>
          <p>
            Most JWTs are <em>signed</em>, not encrypted. Anyone holding one can read it, so it should never carry secrets. The signature only proves who wrote it and that nobody changed it. The standard is <a href="https://www.rfc-editor.org/rfc/rfc7519" className="text-foreground underline underline-offset-4 hover:text-primary">RFC 7519</a>.
          </p>
        </Part>

        <Part title="Three parts, separated by dots" id="structure">
          <p className="break-all rounded-xl border bg-card p-4 font-mono text-sm leading-relaxed">
            <Seg tone="header">eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9</Seg>.<Seg tone="payload">eyJzdWIiOiJ1c2VyLTQyIiwiZXhwIjoxNzk0MzQ1MTk4fQ</Seg>.<Seg tone="signature">eWs5MFtZNmQSIeMI2pP2pK6NWfiuR6MfAd2wC6WeFDE</Seg>
          </p>
          <p>
            <strong className="font-medium text-foreground">Header:</strong> how the token is protected, for example <C>{`{"alg": "RS256", "kid": "key-2"}`}</C>. <C>alg</C> names the algorithm and <C>kid</C> says which of the issuer's keys was used.
          </p>
          <p>
            <strong className="font-medium text-foreground">Payload:</strong> the claims, such as who the token is about and when it expires.
          </p>
          <p>
            <strong className="font-medium text-foreground">Signature:</strong> computed over the first two parts with the issuer's key. Change one character of the header or payload and it no longer matches.
          </p>
          <p>
            The first two parts are just JSON in Base64URL encoding, which is why any tool can decode them. Decoding isn't verifying: only checking the signature with the right key tells you the token is genuine.
          </p>
        </Part>

        <Part title="Signed (JWS) and encrypted (JWE)" id="jws-and-jwe">
          <p>
            A signed token is a JWS: three parts, readable by anyone. An encrypted token is a JWE: five parts (header, encrypted key, IV, ciphertext and tag), readable only with the right private or shared key. A JWE often wraps a signed token, so the contents are both private and verifiable.
          </p>
        </Part>

        <Part title="Registered claims" id="claims">
          <p>These have the same meaning everywhere. Issuers add their own claims alongside them.</p>
          <dl className="divide-y rounded-xl border bg-card text-base">
            {claims.map(([key, name, text]) => (
              <div key={key} id={`claim-${key}`} className="grid gap-1 p-4 sm:grid-cols-[9rem_1fr] sm:gap-4">
                <dt className="font-medium text-foreground">{name} <C>{key}</C></dt>
                <dd>{text}</dd>
              </div>
            ))}
          </dl>
          <p>Time claims are whole seconds since 1 January 1970 UTC, not milliseconds.</p>
        </Part>

        <Part title="Signing algorithms" id="algorithms">
          <p>
            <strong className="font-medium text-foreground">HMAC (HS256, HS384, HS512)</strong> uses one shared secret. Whoever can verify a token can also create one, so it suits a single service talking to itself.
          </p>
          <p>
            <strong className="font-medium text-foreground">Public-key (RS*, PS*, ES*, EdDSA)</strong> signs with a private key that only the issuer holds and verifies with a public key that anyone can have. This is what sign-in providers use, because APIs can check tokens without being able to forge them.
          </p>
        </Part>

        <Part title="Where the keys come from" id="issuer-keys">
          <p>
            OpenID Connect providers publish their public keys as a JSON Web Key Set (JWKS). Take the token's <C>iss</C>, add <C>/.well-known/openid-configuration</C>, and the document there gives a <C>jwks_uri</C>. The key whose <C>kid</C> matches the token's header verifies it.
          </p>
          <p>
            A match proves that issuer signed the token. It doesn't prove you should trust that issuer: a service should only accept issuers it already knows. Tessera does this lookup with <a href={`${paths.guide}#issuer`} className="text-foreground underline underline-offset-4 hover:text-primary">Fetch keys from issuer</a>.
          </p>
        </Part>

        <Part title="Common mistakes" id="pitfalls">
          <p>Tessera's security checks look for each of these.</p>
          {pitfalls.map((p) => (
            <section key={p.id} id={p.id} className="scroll-mt-24 rounded-xl border bg-card p-5">
              <h3 className="text-lg font-medium text-foreground">{p.title}</h3>
              <p className="mt-2 text-base leading-relaxed">{p.body}</p>
            </section>
          ))}
        </Part>

        <p className="mt-16 text-muted-foreground">
          Ready to look at a real token? The <a href={paths.guide} className="text-foreground underline underline-offset-4 hover:text-primary">Guide</a> shows how to inspect, verify, decrypt and build tokens in Tessera.
        </p>
      </div>
    </TesseraLayout>
  );
}
