"use client";

import { VIDEO_URL } from "@/lib/config";

/** Demo video: an mp4 plays natively, a Vimeo player url is embedded, anything else shows the placeholder. */
export function Video() {
  const url = VIDEO_URL.trim();
  if (/\.(mp4|webm)(\?.*)?$/i.test(url)) {
    return <video className="video" src={url} controls playsInline preload="metadata" />;
  }
  if (/^https:\/\/player\.vimeo\.com\//.test(url)) {
    return <iframe className="video" src={url} allow="fullscreen; picture-in-picture" allowFullScreen title="Deed demo video" />;
  }
  return (
    <div className="video placeholder" role="img" aria-label="Demo video coming soon">
      <div className="play" />
      <div>Demo video coming soon</div>
    </div>
  );
}
