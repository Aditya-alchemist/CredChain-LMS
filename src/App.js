import React, { useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";
import "./App.css";
import { CONTRACT_ABI, CONTRACT_ADDRESS } from "./contract";

const short = (a) => (a ? `${a.slice(0, 6)}...${a.slice(-4)}` : "-");
const isInt = (s) => /^\d+$/.test(String(s || ""));

export default function App() {
  const [tab, setTab] = useState("verify"); // verify | issue | admin | mytokens

  const [provider, setProvider] = useState(null);
  const [signer, setSigner] = useState(null);
  const [account, setAccount] = useState("");
  const [chainId, setChainId] = useState(null);

  const [owner, setOwner] = useState("");
  const [amIssuer, setAmIssuer] = useState(false);

  const [toast, setToast] = useState({ type: "idle", msg: "" });

  // admin
  const [issuerAddr, setIssuerAddr] = useState("");
  const [issuerAllowed, setIssuerAllowed] = useState(true);

  // issue
  const [learner, setLearner] = useState("");
  const [course, setCourse] = useState("Entrepreneurship Basics");
  const [moduleId, setModuleId] = useState("M1");
  const [uri, setUri] = useState("");
  const [mintedId, setMintedId] = useState("");
  const [txHash, setTxHash] = useState("");

  // verify
  const [tokenId, setTokenId] = useState("");
  const [cred, setCred] = useState(null);
  const [jsonToCheck, setJsonToCheck] = useState("");
  const [hashMatch, setHashMatch] = useState(null);

  // my tokens (simple: query past events)
  const [myCreds, setMyCreds] = useState([]);

  const read = useMemo(() => (provider ? new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, provider) : null), [provider]);
  const write = useMemo(() => (signer ? new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer) : null), [signer]);

  async function connect() {
    try {
      if (!window.ethereum) return setToast({ type: "err", msg: "MetaMask not found" });
      const p = new ethers.BrowserProvider(window.ethereum);
      await p.send("eth_requestAccounts", []);
      const s = await p.getSigner();
      const addr = await s.getAddress();
      const net = await p.getNetwork();
      setProvider(p);
      setSigner(s);
      setAccount(addr);
      setChainId(Number(net.chainId));
      setToast({ type: "ok", msg: "Connected" });
    } catch (e) {
      setToast({ type: "err", msg: e?.shortMessage || e?.message || "Connect failed" });
    }
  }

  async function loadRoles() {
    if (!read || !account) return;
    try {
      const o = await read.owner();
      const issuer = await read.isIssuer(account);
      setOwner(o);
      setAmIssuer(Boolean(issuer));
    } catch {
      setToast({ type: "err", msg: "Failed to read roles" });
    }
  }

  useEffect(() => { loadRoles(); }, [read, account]); // eslint-disable-line

  useEffect(() => {
    if (!window.ethereum) return;
    const reload = () => window.location.reload();
    window.ethereum.on?.("accountsChanged", reload);
    window.ethereum.on?.("chainChanged", reload);
    return () => {
      window.ethereum.removeListener?.("accountsChanged", reload);
      window.ethereum.removeListener?.("chainChanged", reload);
    };
  }, []);

  async function adminSetIssuer() {
    if (!write) return setToast({ type: "err", msg: "Connect wallet" });
    if (!ethers.isAddress(issuerAddr)) return setToast({ type: "err", msg: "Bad issuer address" });

    try {
      setToast({ type: "info", msg: "Updating issuer..." });
      const tx = await write.setIssuer(issuerAddr, issuerAllowed);
      setTxHash(tx.hash);
      await tx.wait();
      setToast({ type: "ok", msg: "Issuer updated" });
      await loadRoles();
    } catch (e) {
      setToast({ type: "err", msg: e?.shortMessage || e?.message || "setIssuer failed (must be owner)" });
    }
  }

  async function mintCredential() {
    if (!write) return setToast({ type: "err", msg: "Connect wallet" });
    if (!ethers.isAddress(learner)) return setToast({ type: "err", msg: "Bad learner address" });

    const meta = {
      course,
      moduleId,
      learner,
      issuer: account,
      issuedAtISO: new Date().toISOString(),
    };
    const json = JSON.stringify(meta);
    const credHash = ethers.keccak256(ethers.toUtf8Bytes(json));

    try {
      setToast({ type: "info", msg: "Minting credential NFT..." });
      setMintedId("");
      const tx = await write.mintCredential(learner, credHash, uri);
      setTxHash(tx.hash);
      const receipt = await tx.wait();

      // parse CredentialMinted event
      const parsed = receipt.logs
        .map((log) => { try { return write.interface.parseLog(log); } catch { return null; } })
        .find((p) => p && p.name === "CredentialMinted");

      if (parsed?.args?.tokenId != null) setMintedId(parsed.args.tokenId.toString());
      setToast({ type: "ok", msg: "Minted! Save tokenId + JSON used for hash." });
    } catch (e) {
      setToast({ type: "err", msg: e?.shortMessage || e?.message || "Mint failed (must be issuer)" });
    }
  }

  async function verifyToken() {
    if (!read) return setToast({ type: "err", msg: "Connect wallet" });
    if (!isInt(tokenId)) return setToast({ type: "err", msg: "tokenId must be integer" });

    try {
      setToast({ type: "info", msg: "Loading token..." });
      setCred(null);
      setHashMatch(null);

      const [ownerOf, uriOf, meta] = await Promise.all([
        read.ownerOf(tokenId.toString()),
        read.tokenURI(tokenId.toString()),
        read.credentialOf(tokenId.toString()),
      ]);

      setCred({
        tokenId,
        ownerOf,
        uriOf,
        issuer: meta.issuer,
        credHash: meta.credHash,
        issuedAt: Number(meta.issuedAt),
        revoked: meta.revoked,
      });

      setToast({ type: "ok", msg: "Loaded" });
    } catch (e) {
      setToast({ type: "err", msg: e?.shortMessage || e?.message || "Verify failed (not minted?)" });
    }
  }

  function checkHash() {
    if (!cred) return;
    try {
      const h = ethers.keccak256(ethers.toUtf8Bytes(jsonToCheck));
      setHashMatch(h.toLowerCase() === cred.credHash.toLowerCase());
    } catch {
      setToast({ type: "err", msg: "Hash check failed" });
    }
  }

  async function loadMyTokens() {
    if (!read || !account) return;
    try {
      setToast({ type: "info", msg: "Loading your minted credentials from events..." });

      // Query CredentialMinted events where learner == account
      const filter = read.filters.CredentialMinted(null, null, account, null, null);
      const logs = await read.queryFilter(filter, 0, "latest");

      const ids = logs.map((l) => l.args.tokenId.toString());
      setMyCreds(ids);
      setToast({ type: "ok", msg: `Found ${ids.length} credential(s)` });
    } catch (e) {
      setToast({ type: "err", msg: e?.shortMessage || e?.message || "Failed to query events" });
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="logo">NFT</div>
          <div>
            <div className="title">Credential NFT</div>
            <div className="sub">ERC-721 credentials + employer verification</div>
          </div>
        </div>

        <div className="wallet">
          <div className="chips">
            <span className="chip">Contract: {short(CONTRACT_ADDRESS)}</span>
            <span className="chip">Chain: {chainId ?? "-"}</span>
            <span className="chip">Owner: {owner ? short(owner) : "-"}</span>
            <span className={`chip ${amIssuer ? "chipOk" : ""}`}>Issuer: {String(amIssuer)}</span>
          </div>
          <button className="btn" onClick={connect}>{account ? short(account) : "Connect MetaMask"}</button>
        </div>
      </header>

      <nav className="tabs">
        <button className={`tab ${tab === "verify" ? "active" : ""}`} onClick={() => setTab("verify")}>Verify</button>
        <button className={`tab ${tab === "issue" ? "active" : ""}`} onClick={() => setTab("issue")}>Mint</button>
        <button className={`tab ${tab === "mytokens" ? "active" : ""}`} onClick={() => setTab("mytokens")}>My Tokens</button>
        <button className={`tab ${tab === "admin" ? "active" : ""}`} onClick={() => setTab("admin")}>Admin</button>
      </nav>

      {toast.msg && (
        <div className={`toast ${toast.type}`}>
          <span>{toast.msg}</span>
          <button className="toastX" onClick={() => setToast({ type: "idle", msg: "" })}>x</button>
        </div>
      )}

      <main className="main">
        {tab === "verify" && (
          <section className="card">
            <h3>Employer Verification (by tokenId)</h3>
            <p>Employer enters tokenId; app reads owner, issuer, hash, uri, and revocation flag.</p>

            <div className="row">
              <input className="input" value={tokenId} onChange={(e) => setTokenId(e.target.value)} placeholder="tokenId (e.g., 0)" />
              <button className="btn btnAlt" onClick={verifyToken} disabled={!provider}>Verify</button>
            </div>

            {cred && (
              <div className="result">
                <div className="resultHeader">
                  <div className={`statusPill ${cred.revoked ? "bad" : "good"}`}>
                    {cred.revoked ? "REVOKED" : "VALID"}
                  </div>
                  <div className="metaLine">Issued: {new Date(cred.issuedAt * 1000).toLocaleString()}</div>
                </div>

                <div className="kv">
                  <div><span>TokenId</span><code>{cred.tokenId}</code></div>
                  <div><span>Owner (learner)</span><code>{cred.ownerOf}</code></div>
                  <div><span>Issuer</span><code>{cred.issuer}</code></div>
                  <div><span>credHash</span><code>{cred.credHash}</code></div>
                  <div><span>tokenURI</span><code>{cred.uriOf || "-"}</code></div>
                </div>

                <div className="hashBox">
                  <div className="hashTitle">Optional integrity check (paste exact JSON)</div>
                  <textarea className="textarea" rows={5} value={jsonToCheck} onChange={(e) => setJsonToCheck(e.target.value)} />
                  <div className="row">
                    <button className="btn" onClick={checkHash}>Check hash</button>
                    {hashMatch !== null && (
                      <div className={`hashBadge ${hashMatch ? "good" : "bad"}`}>
                        Match: {String(hashMatch)}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </section>
        )}

        {tab === "issue" && (
          <section className="card">
            <h3>Mint Credential NFT (Issuer)</h3>
            <p>This mints an ERC-721 credential to the learner wallet and stores only a hash + optional URI.</p>

            <div className="grid2">
              <div>
                <label>Learner wallet</label>
                <input className="input" value={learner} onChange={(e) => setLearner(e.target.value)} placeholder="0x..." />
              </div>
              <div>
                <label>URI (optional)</label>
                <input className="input" value={uri} onChange={(e) => setUri(e.target.value)} placeholder="ipfs:// or https://" />
              </div>
              <div>
                <label>Course</label>
                <input className="input" value={course} onChange={(e) => setCourse(e.target.value)} />
              </div>
              <div>
                <label>Module ID</label>
                <input className="input" value={moduleId} onChange={(e) => setModuleId(e.target.value)} />
              </div>
            </div>

            <div className="row">
              <button className="btn" onClick={mintCredential} disabled={!signer}>Mint NFT</button>
              {txHash && <span className="chip">Tx: {short(txHash)}</span>}
              {mintedId !== "" && <span className="chip chipOk">tokenId: {mintedId}</span>}
            </div>
          </section>
        )}

        {tab === "mytokens" && (
          <section className="card">
            <h3>My credential tokens</h3>
            <p>Lists tokens minted to your wallet by scanning the CredentialMinted event.</p>

            <div className="row">
              <button className="btn btnAlt" onClick={loadMyTokens} disabled={!provider || !account}>Load my tokens</button>
              <span className="hint">This is demo-friendly (event scan) and avoids needing ERC721Enumerable.</span>
            </div>

            <div className="tokenList">
              {myCreds.length === 0 ? (
                <div className="hint">No tokens loaded yet.</div>
              ) : (
                myCreds.map((id) => (
                  <button
                    key={id}
                    className="tokenBtn"
                    onClick={() => { setTab("verify"); setTokenId(id); }}
                  >
                    tokenId #{id}
                  </button>
                ))
              )}
            </div>
          </section>
        )}

        {tab === "admin" && (
          <section className="card">
            <h3>Admin: setIssuer</h3>
            <p>Only the contract owner can grant/revoke issuer rights.</p>

            <div className="grid2">
              <div>
                <label>Issuer address</label>
                <input className="input" value={issuerAddr} onChange={(e) => setIssuerAddr(e.target.value)} placeholder="0x..." />
              </div>
              <div>
                <label>Allowed</label>
                <select className="select" value={issuerAllowed ? "true" : "false"} onChange={(e) => setIssuerAllowed(e.target.value === "true")}>
                  <option value="true">true (grant)</option>
                  <option value="false">false (remove)</option>
                </select>
              </div>
            </div>

            <div className="row">
              <button className="btn btnAlt" onClick={adminSetIssuer} disabled={!signer}>Update issuer</button>
              <span className="hint">Owner: {short(owner)} | Connected: {short(account)}</span>
            </div>
          </section>
        )}
      </main>

      <footer className="footer">
        <span>Contract: {CONTRACT_ADDRESS}</span>
      </footer>
    </div>
  );
  
}
