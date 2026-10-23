# Result Hunter: temporary search source, 23 October 2026

The existing `vinyl-search-api` Render service now uses Result Hunter for general web searches. Yep is disabled because server-side requests were denied. This change uses the existing free Docker service and adds no API credentials or paid services. The existing Rillenradar Brave API fallback and its limits are unchanged.

## Deployment

- Runtime commit: `ced0a9f0761e5049a82419b5da15136c600e8584`.
- Render deployment: `dep-dbdmop942hec739cmc20`, confirmed live at 2026-10-23 14:18:16 UTC.
- Public endpoint: https://vinyl-search-api.onrender.com.
- `/healthz`: HTTP 200. `/config`: Result Hunter enabled for general web search; Yep disabled. Existing image, video, translation and currency engines retain their original configuration.
- Render service remains on the free plan, one instance, with no added persistent disk.

## Implementation and checks

- Enable the existing Result Hunter engine and retain the 6-second engine/request timeout, 10-second maximum request timeout, and upstream suspension/backoff behavior.
- Correct the pinned engine parser to select the first headline link and title instead of concatenating every anchor in a result card. Invalidate its upstream unchecked-hash Python bytecode so the corrected source actually runs.
- Four offline regression tests passed inside the deployed image: a card with icon/sitelinks, separate cards, cards without a destination/headline, and merged search configuration. A follow-up test wording/filter clarification distinguishes general web search from the unchanged image/video and utility engines.
- The prior certificate security patch, pinned certifi package, and TLS rejection checks are preserved. Both compromised eMudhra test chains were rejected in the successful build; the valid HTTPS control succeeded.
- 52 existing Rillenradar fallback regression checks passed using isolated synthetic APIs. They made no paid search requests.
- After deployment, the three live requests below used `format=json`, `language=de-DE`, `categories=general` and **no engine override**, matching Rillenradar requests. Every returned result came from Result Hunter, and all engine-error lists were empty.
- Live results were passed through the existing Rillenradar `normalizeSearchHit` and `mergeSearchHits` functions, including merchant, title and media-format checks. No frontend source was changed.
- No result contained concatenated HTTP(S) destination URLs. The eBay cards for The Wall now have individual URLs.
- No error-level service logs were returned for the post-deployment interval through 14:22:44 UTC.

## Live search evidence

Observed at 2026-10-23T14:21:08.810Z. Times are observations from the test runner, not a performance guarantee.

| Query | Raw results | Accepted unique hits | Merchants/catalogs | Elapsed |
| --- | ---: | ---: | --- | ---: |
| Genesis Foxtrot CD | 19 | 12 | jpc, Discogs, RecordSale, Amazon, medimops | 8956 ms |
| Pink Floyd The Wall Vinyl | 20 | 9 | Discogs, RecordSale, eBay, Saturn, MediaMarkt, jpc | 1111 ms |
| site:medimops.de Genesis Foxtrot CD | 20 | 2 | medimops | 6671 ms |

Representative returned links:

- Genesis Foxtrot CD — jpc: https://www.jpc.de/jpcng/poprock/detail/-/art/Genesis-Foxtrot/hnum/4719586
- Genesis Foxtrot CD — Discogs: https://www.discogs.com/de/master/28853-Genesis-Foxtrot
- Genesis Foxtrot CD — RecordSale: https://recordsale.de/de/kuenstler/genesis/albums/foxtrot
- Pink Floyd The Wall Vinyl — Discogs: https://www.discogs.com/de/release/539804-Pink-Floyd-The-Wall
- Pink Floyd The Wall Vinyl — RecordSale: https://recordsale.de/de/kuenstler/pink-floyd/albums/the-wall
- Pink Floyd The Wall Vinyl — eBay: https://www.ebay.de/b/Pink-Floyd-The-Wall-Vinyl/bn_7005716933
- site:medimops.de Genesis Foxtrot CD — medimops: https://www.medimops.de/genesis-foxtrot-audio-cd-M0B001R4MEU2.html

## Scope and remaining checks

This verifies the deployed search service and actual Rillenradar result normalization. It does not establish that every returned merchant page has current stock or a verified lowest price. Existing product-page checks still determine price and availability. No signed-in browser, Android-device or iPhone UI test was performed for this backend-only change; login, collections, PWA assets and APK files were not modified.

Result Hunter is a temporary source without a guarantee of uninterrupted availability or complete shop coverage. No provider blocks were bypassed and no proxy or client-fingerprint rotation was added. Re-enable Yep only after an authorized normal request confirms recovery; retain the certificate security updates when changing search engines again.
