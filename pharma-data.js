/* ==========================================================
   pharma-data.js
   Shared, key-free drug data fetcher used by app.js (Drug
   Search) and pharmarag.html (PharmaRAG chat).

   Fallback chain (all free, no API key required):
   1. openFDA          — drug label data (US)
   2. RxNorm (NLM)      — normalizes brand/generic names,
                          then retries openFDA with the
                          normalized generic name
   3. MedlinePlus Connect (NLM) — consumer-friendly drug
                          info + link, used when no FDA
                          label data exists at all
   ========================================================== */

const PharmaData = (function () {

    async function tryOpenFDA(name) {
        try {
            const url = `https://api.fda.gov/drug/label.json?search=openfda.generic_name:"${name}"+OR+openfda.brand_name:"${name}"&limit=1`;
            const res = await fetch(url);
            if (!res.ok) return null;
            const json = await res.json();
            const result = json.results && json.results[0];
            if (!result) return null;
            return result;
        } catch (e) {
            return null;
        }
    }

    async function rxNormalize(name) {
        try {
            const res = await fetch(`https://rxnav.nlm.nih.gov/REST/rxcui.json?name=${encodeURIComponent(name)}`);
            if (!res.ok) return null;
            const json = await res.json();
            const rxcui = json && json.idGroup && json.idGroup.rxnormId && json.idGroup.rxnormId[0];
            if (!rxcui) return null;

            let genericName = null;
            try {
                const relRes = await fetch(`https://rxnav.nlm.nih.gov/REST/rxcui/${rxcui}/related.json?tty=IN`);
                const relJson = await relRes.json();
                const group = relJson && relJson.relatedGroup && relJson.relatedGroup.conceptGroup;
                const ingredient = group && group.find(g => g.tty === 'IN');
                genericName = ingredient && ingredient.conceptProperties && ingredient.conceptProperties[0] && ingredient.conceptProperties[0].name;
            } catch (e) { /* ignore, rxcui still useful */ }

            return { rxcui, genericName };
        } catch (e) {
            return null;
        }
    }

    async function tryMedlinePlus(rxcui) {
        try {
            const url = `https://connect.medlineplus.gov/service?mainSearchCriteria.v.cs=RXCUI&mainSearchCriteria.v.c=${rxcui}&knowledgeResponseType=application/json`;
            const res = await fetch(url);
            if (!res.ok) return null;
            const json = await res.json();
            const entries = json && json.feed && json.feed.entry;
            if (!entries || !entries.length) return null;
            return entries.map(e => ({
                title: e.title && e.title._value,
                link: e.link && e.link[0] && e.link[0].href
            })).filter(e => e.title);
        } catch (e) {
            return null;
        }
    }

    /**
     * Main entry point.
     * Returns a normalized object:
     * {
     *   source: 'openfda' | 'openfda-rxnorm' | 'medlineplus' | null,
     *   name: string,
     *   fda: <raw openFDA label result> | null,
     *   medline: [{title, link}] | null
     * }
     * Returns null if nothing found anywhere.
     */
    async function fetchDrugInfo(rawName) {
        const name = rawName.trim().toLowerCase();
        if (!name) return null;

        // 1. Direct openFDA
        const direct = await tryOpenFDA(name);
        if (direct) {
            return { source: 'openfda', name, fda: direct, medline: null };
        }

        // 2. Normalize via RxNorm, retry openFDA with generic name
        const rx = await rxNormalize(name);
        if (rx && rx.genericName) {
            const retry = await tryOpenFDA(rx.genericName.toLowerCase());
            if (retry) {
                return { source: 'openfda-rxnorm', name: rx.genericName, fda: retry, medline: null };
            }
        }

        // 3. MedlinePlus fallback (consumer-friendly info, always has a rxcui if step 2 found one)
        if (rx && rx.rxcui) {
            const medline = await tryMedlinePlus(rx.rxcui);
            if (medline) {
                return { source: 'medlineplus', name: rx.genericName || name, fda: null, medline };
            }
        }

        return null;
    }

    return { fetchDrugInfo };
})();
