"use client";

import QRCode from "qrcode";
import {
  FormEvent,
  useEffect,
  useRef,
  useState,
} from "react";

type Preview = {
  title: string | null;
  description: string | null;
  image_url: string | null;
  site_name: string | null;
  favicon_url: string | null;
};

type LinkResult = {
  short_code: string;
  short_url: string;
  original_url: string;
  expires_at: string | null;
  click_count: string;
  preview: Preview;
};

type ApiError = { error?: { code?: string; message?: string } };

const errorCopy: Record<string, string> = {
  INVALID_REQUEST: "入力内容を確認してください。URLは http:// または https:// から始めてください。",
  CONFLICT: "そのカスタムコードはすでに使われています。別の名前をお試しください。",
  RATE_LIMITED: "短時間にたくさん作成されています。少し待ってからお試しください。",
  SERVICE_UNAVAILABLE: "リンクサービスを現在利用できません。しばらくしてからお試しください。",
  INTERNAL_ERROR: "予期しないエラーが発生しました。しばらくしてからお試しください。",
};

function toJapaneseError(payload: ApiError, status: number) {
  const code = payload.error?.code;
  return (
    (code && errorCopy[code]) ||
    payload.error?.message ||
    (status === 429
      ? "短時間にたくさん作成されています。少し待ってからお試しください。"
      : "リンクを作成できませんでした。入力内容を確認してもう一度お試しください。")
  );
}

function readableHost(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function localDateTimeValue(date: Date) {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16);
}

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("copy_failed");
}

export default function Home() {
  const formRef = useRef<HTMLFormElement>(null);
  const [url, setUrl] = useState("");
  const [customCode, setCustomCode] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [password, setPassword] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [result, setResult] = useState<LinkResult | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrStatus, setQrStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [error, setError] = useState("");
  const [customError, setCustomError] = useState("");
  const [urlError, setUrlError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "done" | "error">("idle");
  const [imageCopyState, setImageCopyState] = useState<"idle" | "done" | "unsupported">("idle");
  const [minDate, setMinDate] = useState("");

  useEffect(() => {
    setMinDate(localDateTimeValue(new Date(Date.now() + 60_000)));
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setUrlError("");
    setCustomError("");
    setCopyState("idle");
    setImageCopyState("idle");
    setResult(null);
    setQrDataUrl(null);
    setQrStatus("idle");

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url.trim());
      if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") throw new Error();
    } catch {
      setUrlError("http:// または https:// から始まるURLを入力してください。");
      return;
    }

    const trimmedCode = customCode.trim();
    if (trimmedCode && !/^[A-Za-z0-9_-]{4,32}$/.test(trimmedCode)) {
      setCustomError("4〜32文字の英数字、ハイフン、アンダースコアで入力してください。");
      return;
    }
    if (password && (password.length < 8 || password.length > 128)) {
      setError("パスワードは8〜128文字で入力してください。");
      return;
    }
    if (expiresAt && new Date(expiresAt).getTime() <= Date.now()) {
      setError("有効期限は未来の日時を指定してください。");
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch("/api/links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          original_url: parsedUrl.toString(),
          ...(trimmedCode ? { custom_code: trimmedCode } : {}),
          expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
          ...(password ? { password } : {}),
        }),
      });
      const payload = (await response.json()) as LinkResult & ApiError;
      if (!response.ok) throw new Error(toJapaneseError(payload, response.status));

      setResult(payload);
      setQrStatus("loading");
      try {
        const dataUrl = await QRCode.toDataURL(payload.short_url, {
          width: 560,
          margin: 2,
          errorCorrectionLevel: "M",
          color: { dark: "#153c3b", light: "#fffdf8" },
        });
        setQrDataUrl(dataUrl);
        setQrStatus("ready");
      } catch {
        setQrDataUrl(null);
        setQrStatus("error");
      }
      setUrl("");
      setCustomCode("");
      setExpiresAt("");
      setPassword("");
      setShowSettings(false);
      formRef.current?.reset();
    } catch (submissionError) {
      setError(
        submissionError instanceof Error && submissionError.message !== ""
          ? submissionError.message
        : "リンクを作成できませんでした。もう一度お試しください。",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleCopy() {
    if (!result) return;
    try {
      await copyText(result.short_url);
      setCopyState("done");
      window.setTimeout(() => setCopyState("idle"), 2200);
    } catch {
      setCopyState("error");
    }
  }

  async function handleImageCopy() {
    if (!qrDataUrl || !("ClipboardItem" in window) || !navigator.clipboard?.write) {
      setImageCopyState("unsupported");
      return;
    }
    try {
      const response = await fetch(qrDataUrl);
      const blob = await response.blob();
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
      setImageCopyState("done");
      window.setTimeout(() => setImageCopyState("idle"), 2200);
    } catch {
      setImageCopyState("unsupported");
    }
  }

  return (
    <main className="page-shell">
      <nav className="topbar" aria-label="メインナビゲーション">
        <a className="brand" href="/" aria-label="Link Pocket ホーム">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
          <span>Link Pocket</span>
        </a>
        <span className="topbar-note"><span className="status-dot" />登録不要で利用できます</span>
      </nav>

      <section className="hero" aria-labelledby="page-title">
        <div className="hero-copy">
          <p className="eyebrow">LINK SHORTENER <span>01</span></p>
          <h1 id="page-title">長いリンクを、<br /><em>短く。</em>わかりやすく。</h1>
          <p className="hero-lede">共有しやすいリンクを、すばやく作成。<br />必要なときだけ、細かな設定もできます。</p>
          <div className="trust-line"><span className="shield-icon" aria-hidden="true">✓</span><span>登録不要 · QRコード対応 · すぐに使える</span></div>
        </div>

        <div className="form-panel">
          <div className="panel-heading">
            <div>
              <p className="panel-kicker">NEW SHORT LINK</p>
              <h2>リンクを短くする</h2>
            </div>
            <span className="panel-step">01 / 01</span>
          </div>
          <form ref={formRef} onSubmit={submit} noValidate>
            <label className="field-label" htmlFor="original-url">短くしたいURL</label>
            <div className={`url-input-wrap${urlError ? " has-error" : ""}`}>
              <span className="link-icon" aria-hidden="true">↗</span>
              <input
                id="original-url"
                name="original_url"
                type="url"
                value={url}
                onChange={(event) => { setUrl(event.target.value); if (urlError) setUrlError(""); }}
                placeholder="https://example.com/your-long-url"
                autoComplete="url"
                aria-invalid={Boolean(urlError)}
                aria-describedby={urlError ? "url-error" : "url-hint"}
                required
              />
            </div>
            {urlError ? <p className="field-error" id="url-error" role="alert">{urlError}</p> : <p className="field-hint" id="url-hint">URLを貼り付けるだけで作成できます</p>}

            <button className="settings-toggle" type="button" aria-expanded={showSettings} onClick={() => setShowSettings((value) => !value)}>
              <span className="settings-leading"><span className="sliders-icon" aria-hidden="true">☷</span>詳細設定</span>
              <span className={`toggle-chevron${showSettings ? " open" : ""}`} aria-hidden="true">⌄</span>
            </button>

            {showSettings && <div className="settings-area">
              <div className="setting-block">
                <label className="field-label" htmlFor="custom-code">カスタムコード <span>任意</span></label>
                <div className="input-prefix-wrap">
                  <span className="input-prefix" aria-hidden="true">/</span>
                  <input id="custom-code" name="custom_code" value={customCode} onChange={(event) => { setCustomCode(event.target.value); setCustomError(""); }} placeholder="my-link" maxLength={32} aria-invalid={Boolean(customError)} aria-describedby={customError ? "custom-error" : undefined} />
                </div>
                {customError && <p className="field-error" id="custom-error" role="alert">{customError}</p>}
              </div>
              <div className="setting-block">
                <label className="field-label" htmlFor="expires-at">有効期限 <span>任意</span></label>
                <input className="plain-input" id="expires-at" name="expires_at" type="datetime-local" value={expiresAt} min={minDate} onChange={(event) => setExpiresAt(event.target.value)} />
              </div>
              <div className="setting-block">
                <label className="field-label" htmlFor="password">パスワード保護 <span>任意</span></label>
                <input className="plain-input" id="password" name="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="8文字以上" minLength={8} maxLength={128} autoComplete="new-password" />
              </div>
              <p className="privacy-note"><span aria-hidden="true">⌁</span> パスワード付きリンクのプレビュー情報は外部に表示されません</p>
            </div>}

            {error && <p className="submit-error" role="alert">{error}</p>}
            <button className="submit-button" type="submit" disabled={isSubmitting}>
              {isSubmitting ? <><span className="spinner" aria-hidden="true" />作成中…</> : <>リンクを作成する <span aria-hidden="true">→</span></>}
            </button>
          </form>
        </div>
      </section>

      {result && <section className="result-section" aria-labelledby="result-title" aria-live="polite">
        <p className="sr-only" aria-live="polite">短いリンクを作成しました。</p>
        <div className="result-rule"><span>YOUR SHORT LINK</span></div>
        <div className="result-grid">
          <div className="result-card">
            <p className="result-label">作成したリンク</p>
            <h2 id="result-title">短いリンクができました。</h2>
            <div className="short-url-row">
              <a href={result.short_url} target="_blank" rel="noreferrer">{result.short_url.replace(/^https?:\/\//, "")}</a>
              <button className="copy-button" type="button" onClick={handleCopy} aria-label="短いリンクをコピー">
                {copyState === "done" ? "コピーしました" : copyState === "error" ? "再試行" : "コピー"}
              </button>
            </div>
            <p className="sr-only" aria-live="polite">{copyState === "done" ? "短いリンクをコピーしました。" : copyState === "error" ? "コピーできませんでした。" : ""}</p>
            <div className="result-meta"><span>{result.expires_at ? `有効期限 ${new Date(result.expires_at).toLocaleDateString("ja-JP")}` : "有効期限なし"}</span><span>作成直後</span></div>
            <p className="stats-note">クリック数は作成時点のスナップショット（{result.click_count}）です。リアルタイムの統計機能はありません。</p>
          </div>
          <div className="qr-card">
            <div className="qr-heading"><span>QR CODE</span><span>読み取りでアクセス</span></div>
            {qrDataUrl ? <img className="qr-image" src={qrDataUrl} alt="短いリンクのQRコード" /> : qrStatus === "error" ? <div className="qr-placeholder qr-error" role="status">QRコードを生成できませんでした</div> : <div className="qr-placeholder" role="status" aria-label="QRコードを生成中">生成中…</div>}
            <div className="qr-actions">
              <a className="qr-action" href={qrDataUrl ?? undefined} download={`link-pocket-${result.short_code}.png`} aria-disabled={!qrDataUrl}>↓ ダウンロード</a>
              <button className="qr-action" type="button" onClick={handleImageCopy} disabled={!qrDataUrl}>{imageCopyState === "done" ? "✓ コピーしました" : imageCopyState === "unsupported" ? "画像コピー非対応" : "▣ 画像をコピー"}</button>
            </div>
          </div>
        </div>
        <div className="preview-card">
          <div className="preview-topline"><span className="preview-icon" aria-hidden="true">↗</span><span>リンクのプレビュー</span><span className="preview-origin">{readableHost(result.original_url)}</span></div>
          <div className="preview-body">
            <div>
              <p className="preview-site">{result.preview.site_name || readableHost(result.original_url) || "ウェブサイト"}</p>
              <h3>{result.preview.title || "プレビューを取得できませんでした"}</h3>
              <p>{result.preview.description || "リンク先のページを開くと、元のコンテンツが表示されます。"}</p>
            </div>
            <span className="preview-arrow" aria-hidden="true">↗</span>
          </div>
        </div>
        <button className="make-another" type="button" onClick={() => { setResult(null); setQrDataUrl(null); setError(""); window.scrollTo({ top: 0, behavior: "smooth" }); }}>＋ もう一つ作成する</button>
      </section>}

      <footer className="footer"><span>Link Pocket</span><span>リンクを、もっと身近に。</span><span>© 2026 Link Pocket</span></footer>
    </main>
  );
}
