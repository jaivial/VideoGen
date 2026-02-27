#!/usr/bin/env python3
"""
YouTube Transcript API Service
Multiple methods to fetch transcripts:
1. YouTube Data API (requires API key - most reliable)
2. youtube-transcript-api (Python library)
3. Invidious (alternative YouTube frontend)
4. Proxy support
"""

import sys
import json
import argparse
import os
import requests

# Try to import youtube-transcript-api
try:
    from youtube_transcript_api import YouTubeTranscriptApi
    YTT_AVAILABLE = True
except ImportError:
    YTT_AVAILABLE = False

# Invidious instances
INVIDIOUS_INSTANCES = [
    "https://yewtu.be",
    "https://invidious.fdn.fr",
    "https://invidious.snopyta.org",
]

def get_proxies():
    """Get list of proxies from environment"""
    proxy_env = os.environ.get('PROXY_LIST', '')
    if not proxy_env:
        return []
    return [p.strip() for p in proxy_env.split(',') if p.strip()]

def get_youtube_api_key():
    """Get YouTube Data API key from environment"""
    return os.environ.get('YOUTUBE_DATA_API_KEY', '')

def get_transcript_via_youtube_api(video_id: str, lang: str = "en") -> dict:
    """
    Fetch transcript via YouTube Data API (most reliable)
    Requires YOUTUBE_DATA_API_KEY environment variable
    """
    api_key = get_youtube_api_key()
    if not api_key:
        return None

    try:
        # Get caption tracks via YouTube Data API
        url = f"https://www.googleapis.com/youtube/v3/captions?part=snippet&videoId={video_id}&key={api_key}"
        resp = requests.get(url, timeout=10)

        if resp.status_code != 200:
            return None

        data = resp.json()
        items = data.get("items", [])

        if not items:
            return None

        # Find the language
        target_lang = lang.split("-")[0]
        caption = None

        for item in items:
            snippet = item.get("snippet", {})
            lang_code = snippet.get("language", "")
            if lang_code == target_lang or lang_code.startswith(target_lang):
                caption = item
                break

        if not caption and items:
            caption = items[0]

        if not caption:
            return None

        # Get video details for title
        video_url = f"https://www.googleapis.com/youtube/v3/videos?part=snippet&id={video_id}&key={api_key}"
        video_resp = requests.get(video_url, timeout=10)

        title = video_id
        if video_resp.status_code == 200:
            video_data = video_resp.json()
            video_items = video_data.get("items", [])
            if video_items:
                title = video_items[0].get("snippet", {}).get("title", video_id)

        return {
            "video_id": video_id,
            "language": caption.get("snippet", {}).get("language", "en"),
            "is_generated": caption.get("snippet", {}).get("trackKind", "") == "ASR",
            "title": title,
            "method": "youtube_data_api"
        }

    except Exception as e:
        return None

def get_transcript_via_invidious(video_id: str, lang: str = "en") -> dict:
    """Fetch transcript via Invidious API"""
    for instance in INVIDIOUS_INSTANCES:
        try:
            info_url = f"{instance}/api/v1/videos/{video_id}"
            resp = requests.get(info_url, timeout=10, headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
            })
            if resp.status_code != 200:
                continue

            video_data = resp.json()
            subtitles = video_data.get("subtitles", [])
            if not subtitles:
                continue

            target_lang = lang.split("-")[0]
            selected_sub = None

            for sub in subtitles:
                sub_lang = sub.get("languageCode", "")
                if sub_lang == target_lang or sub_lang.startswith(target_lang):
                    selected_sub = sub
                    break

            if not selected_sub and subtitles:
                selected_sub = subtitles[0]

            if not selected_sub:
                continue

            sub_url = selected_sub.get("url", "")
            if sub_url.startswith("//"):
                sub_url = "https:" + sub_url
            elif sub_url.startswith("/"):
                sub_url = instance + sub_url

            sub_resp = requests.get(sub_url, timeout=10)
            if sub_resp.status_code != 200:
                continue

            subtitle_text = sub_resp.text
            entries = parse_vtt(subtitle_text)

            if entries:
                return {
                    "video_id": video_id,
                    "language": selected_sub.get("languageCode", "en"),
                    "is_generated": False,
                    "transcript": entries,
                    "method": "invidious"
                }

        except Exception as e:
            continue

    return None

def parse_vtt(vtt_text: str) -> list:
    """Parse VTT subtitle format"""
    lines = vtt_text.strip().split('\n')
    entries = []
    i = 0
    current_start = 0
    current_text = []

    while i < len(lines):
        line = lines[i].strip()

        if not line or line.startswith("WEBVTT") or line.startswith("NOTE"):
            i += 1
            continue

        if "-->" in line:
            parts = line.split("-->")
            if parts:
                time_str = parts[0].strip()
                current_start = parse_vtt_time(time_str)
            i += 1
            continue

        if line:
            current_text.append(line)

        if i + 1 < len(lines) and (not lines[i + 1].strip() or "-->" in lines[i + 1]):
            if current_text:
                text = " ".join(current_text)
                entries.append({
                    "text": text,
                    "start": current_start,
                    "duration": 3.0
                })
                current_text = []
                current_start = 0

        i += 1

    if current_text:
        entries.append({
            "text": " ".join(current_text),
            "start": current_start,
            "duration": 3.0
        })

    return entries

def parse_vtt_time(time_str: str) -> float:
    """Parse VTT timestamp to seconds"""
    try:
        parts = time_str.split(":")
        if len(parts) == 3:
            hours = int(parts[0])
            minutes = int(parts[1])
            seconds = float(parts[2])
            return hours * 3600 + minutes * 60 + seconds
        elif len(parts) == 2:
            minutes = int(parts[0])
            seconds = float(parts[1])
            return minutes * 60 + seconds
    except:
        pass
    return 0.0

def get_transcript_via_ytt(video_id: str, lang: str = None, proxy: str = None) -> dict:
    """Fetch transcript via youtube-transcript-api"""
    if not YTT_AVAILABLE:
        return None

    try:
        proxies = None
        if proxy:
            proxies = {'http': proxy, 'https': proxy}

        yt_api = YouTubeTranscriptApi(proxy_config=proxies)
        transcript_list = yt_api.list(video_id)

        transcript = None

        if lang:
            try:
                transcript = transcript_list.find_transcript([lang])
            except Exception:
                pass

        if not transcript:
            try:
                transcript = transcript_list.find_transcript(['en', 'en-US'])
            except Exception:
                try:
                    transcript = transcript_list.find_generated_transcript(['en'])
                except Exception:
                    all_transcripts = list(transcript_list)
                    if all_transcripts:
                        transcript = transcript_list.find_transcript([all_transcripts[0].language_code])

        if not transcript:
            return None

        transcript_data = transcript.fetch()

        formatted_transcript = []
        for entry in transcript_data:
            formatted_transcript.append({
                "text": entry.text,
                "start": entry.start,
                "duration": entry.duration
            })

        return {
            "video_id": video_id,
            "language": transcript.language,
            "is_generated": transcript.is_generated,
            "transcript": formatted_transcript,
            "method": "youtube-transcript-api"
        }

    except Exception as e:
        return None

def get_transcript(video_id: str, lang: str = None, proxy: str = None) -> dict:
    """
    Main function - tries multiple methods in order:
    1. YouTube Data API (if API key available)
    2. Invidious
    3. youtube-transcript-api
    4. Proxy
    """
    lang = lang or "en"

    # Method 1: YouTube Data API (most reliable if key available)
    result = get_transcript_via_youtube_api(video_id, lang)
    if result:
        return result

    # Method 2: Invidious
    result = get_transcript_via_invidious(video_id, lang)
    if result:
        return result

    # Method 3: youtube-transcript-api without proxy
    result = get_transcript_via_ytt(video_id, lang, None)
    if result:
        return result

    # Method 4: Try with proxy if available
    if proxy:
        result = get_transcript_via_ytt(video_id, lang, proxy)
        if result:
            return result

    # Method 5: Try all proxies from env
    proxies = get_proxies()
    for p in proxies:
        result = get_transcript_via_ytt(video_id, lang, p)
        if result:
            return result

    return None

def try_proxies(video_id: str, lang: str, proxies: list) -> dict:
    """Try fetching transcript with each proxy"""
    for proxy in proxies:
        result = get_transcript_via_ytt(video_id, lang, proxy)
        if result:
            return result
    return None

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="YouTube Transcript Fetcher")
    parser.add_argument("video_id", help="YouTube video ID")
    parser.add_argument("--lang", "-l", default=None, help="Language code")
    parser.add_argument("--proxy", "-p", default=None, help="Proxy URL")
    parser.add_argument("--use-all-proxies", "-a", action="store_true", help="Try all proxies from PROXY_LIST")
    parser.add_argument("--method", "-m", default="all", choices=["all", "api", "invidious", "ytt"], help="Force specific method")

    args = parser.parse_args()

    lang = args.lang or "en"

    if args.method == "api":
        result = get_transcript_via_youtube_api(args.video_id, lang)
    elif args.method == "invidious":
        result = get_transcript_via_invidious(args.video_id, lang)
    elif args.method == "ytt":
        result = get_transcript_via_ytt(args.video_id, lang, args.proxy)
    else:
        result = get_transcript(args.video_id, lang, args.proxy)

    if result:
        # Remove method from output
        if "method" in result:
            del result["method"]
        print(json.dumps(result))
    else:
        print(json.dumps({"error": "Could not retrieve transcript. Add YOUTUBE_DATA_API_KEY for reliable fetching."}))
        sys.exit(1)
