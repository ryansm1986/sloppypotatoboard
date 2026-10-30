const path = require('node:path');
const { net } = require('electron');
const { AUDIO_EXT, prettyName } = require('./library');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0 Safari/537.36';
const CT_EXT = {
  'audio/mpeg': '.mp3',
  'audio/mp3': '.mp3',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'audio/wave': '.wav',
  'audio/ogg': '.ogg',
  'audio/flac': '.flac',
  'audio/x-flac': '.flac',
  'audio/mp4': '.m4a',
  'audio/x-m4a': '.m4a',
  'audio/aac': '.aac',
  'audio/webm': '.webm',
  'audio/opus': '.opus',
};

const extOf = (u) => path.extname(new URL(u).pathname).toLowerCase();

function cleanTitle(t) {
  if (!t) return null;
  const s = t
    .replace(/&amp;/g, '&')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .split(/\s[-|–]\s/)[0]
    .trim();
  return s && !/^search/i.test(s) ? s : null;
}

/**
 * Accepts a direct audio link or a web page that embeds one (myinstants, most
 * soundboard sites). Returns { buffer, ext, name }.
 */
async function fetchAudio(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new Error("That doesn't look like a link");
  }
  if (!/^https?:$/.test(url.protocol)) throw new Error('Only http(s) links work');
  if (/(^|\.)(youtube\.com|youtu\.be|tiktok\.com|instagram\.com|twitter\.com|x\.com)$/i.test(url.hostname)) {
    throw new Error("Video sites aren't supported. Find the clip on a soundboard site like myinstants.com, or download the audio file and drop it in.");
  }

  let res = await net.fetch(url.href, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`The site said ${res.status}`);
  let type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  let audioUrl = res.url || url.href;
  let name = null;

  if (type.startsWith('text/html')) {
    const html = await res.text();
    name = cleanTitle((html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1]);
    const og = html.match(/<meta[^>]+property=["']og:audio(?::url)?["'][^>]+content=["']([^"']+)["']/i);
    const any = html.match(/["'(]((?:https?:)?\/{0,2}[^"'()\s<>]+?\.(?:mp3|wav|ogg|m4a|flac|opus|webm))(?:\?[^"'()\s<>]*)?["')]/i);
    const found = og?.[1] || any?.[1];
    if (!found) throw new Error("Couldn't find an audio file on that page");
    audioUrl = new URL(found, res.url || url.href).href;
    res = await net.fetch(audioUrl, { headers: { 'User-Agent': UA, Referer: url.href } });
    if (!res.ok) throw new Error(`The site said ${res.status}`);
    type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  }

  let ext = extOf(audioUrl);
  if (!AUDIO_EXT.has(ext)) ext = CT_EXT[type];
  if (!ext) throw new Error("That link isn't an audio file");

  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length < 512) throw new Error('That file is empty');
  return { buffer, ext, name: name || prettyName(decodeURIComponent(new URL(audioUrl).pathname)) };
}

module.exports = { fetchAudio };
