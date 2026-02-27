#!/usr/bin/env node
/**
 * YouTube Transcript API Service
 * Uses Node.js youtube-transcript-api library
 * Supports proxy configuration via PROXY_LIST env var
 */

const TranscriptClient = require('youtube-transcript-api');

// Parse arguments
const args = process.argv.slice(2).reduce((acc, arg) => {
  const [key, value] = arg.split('=');
  acc[key.replace('--', '')] = value;
  return acc;
}, {});

const videoId = args.video;
const lang = args.lang || 'en';
const useAllProxies = args['use-all-proxies'] === 'true';

// Get proxy list from environment
const proxyList = (process.env.PROXY_LIST || '').split(',').filter(p => p.trim());

// Parse proxy URL to Axios proxy format
function parseProxyUrl(proxyUrl) {
  try {
    const url = new URL(proxyUrl.trim());
    return {
      protocol: url.protocol.replace(':', ''),
      host: url.hostname,
      port: parseInt(url.port) || (url.protocol === 'https:' ? 443 : 80),
      auth: url.username ? {
        username: url.username,
        password: url.password
      } : undefined
    };
  } catch (e) {
    return undefined;
  }
}

async function getTranscript(proxyUrl = null) {
  const axiosConfig = {};

  if (proxyUrl) {
    const proxy = parseProxyUrl(proxyUrl);
    if (proxy) {
      axiosConfig.proxy = proxy;
    }
  }

  const client = new TranscriptClient(axiosConfig);
  await client.ready;

  const transcript = await client.getTranscript(videoId, {
    lang: lang,
  });

  return transcript;
}

async function main() {
  if (!videoId) {
    console.error(JSON.stringify({ error: 'Video ID is required. Usage: node youtube_transcript.js --video=VIDEO_ID' }));
    process.exit(1);
  }

  try {
    // Try without proxy first
    let transcript = await getTranscript(null);

    console.log(JSON.stringify({
      video_id: videoId,
      language: lang,
      is_generated: false,
      transcript: transcript.map(item => ({
        text: item.text,
        start: item.offset / 1000,
        duration: item.duration / 1000
      }))
    }));
    process.exit(0);

  } catch (error) {
    const errorMsg = error.message || String(error);

    // If failed and proxies available, try them
    if (proxyList.length > 0) {
      console.error('Initial fetch failed, trying proxies...', errorMsg);

      for (const proxy of proxyList) {
        try {
          const transcript = await getTranscript(proxy);

          console.log(JSON.stringify({
            video_id: videoId,
            language: lang,
            is_generated: false,
            transcript: transcript.map(item => ({
              text: item.text,
              start: item.offset / 1000,
              duration: item.duration / 1000
            }))
          }));
          process.exit(0);
        } catch (e) {
          console.error(`Proxy ${proxy} failed:`, e.message);
          continue;
        }
      }
    }

    // Check for IP block
    let userError = errorMsg;
    if (errorMsg.includes('ECONNRESET') || errorMsg.includes('blocked') || errorMsg.includes('429')) {
      userError = 'YouTube is blocking this IP. Try using a proxy via PROXY_LIST environment variable.';
    }

    console.error(JSON.stringify({ error: userError }));
    process.exit(1);
  }
}

main();
