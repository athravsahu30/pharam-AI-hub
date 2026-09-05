/* ==========================================================
   pharma-data.js
   Shared, key-free drug data fetcher used by app.js (Drug
   Search) and pharmarag.html (PharmaRAG chat).

   Sources used (all free, no API key required):
   1. openFDA (label)        — official FDA drug label (uses,
                                ADR, dosage, warnings)
   2. RxNorm (NLM)           — normalizes brand/generic names,
                                retries openFDA with the
                                normalized generic name
   3. MedlinePlus Connect    — consumer-friendly info + links,
      (NLM)                    used when no FDA label exists
   4. DailyMed (NLM)         — official label lookup link
                                (SPL), often has more brands
                                listed than openFDA
   5. PubChem (NIH)          — chemistry: molecular formula,
                                weight, IUPAC name
   6. ClinicalTrials.gov     — active/recent research studies
                                for the drug
   7. openFDA (adverse event)— real-world top reported side
                                effects (from patient reports)
   8. openFDA (enforcement)  — recall / safety alert info
   9. ChEMBL (EMBL-EBI)      — mechanism of action
   10. openFDA (NDC Directory)— manufacturer, route, dosage form
   11. PubMed (NCBI E-utils) — related research article links

   Translation: free, key-free English → Hindi translation
   (used for bilingual results), with an automatic fallback
   between two free providers if one is unavailable.
   ========================================================== */

const PharmaData = (function () {

    // Wraps fetch with a hard timeout — a slow/unreachable source
    // will fail gracefully instead of hanging the whole search.
    async function fetchWithTimeout(url, ms = 6000) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), ms);
        try {
            const res = await fetch(url, { signal: controller.signal });
            return res;
        } finally {
            clearTimeout(timer);
        }
    }

    // ---------- 1. openFDA drug label ----------
    async function tryOpenFDA(name) {
        try {
            const url = `https://api.fda.gov/drug/label.json?search=openfda.generic_name:"${name}"+OR+openfda.brand_name:"${name}"&limit=1`;
            const res = await fetchWithTimeout(url);
            if (!res.ok) return null;
            const json = await res.json();
            return (json.results && json.results[0]) || null;
        } catch (e) {
            return null;
        }
    }

    // ---------- 2. RxNorm name normalization ----------
    async function rxNormalize(name) {
        try {
            const res = await fetchWithTimeout(`https://rxnav.nlm.nih.gov/REST/rxcui.json?name=${encodeURIComponent(name)}`);
            if (!res.ok) return null;
            const json = await res.json();
            const rxcui = json && json.idGroup && json.idGroup.rxnormId && json.idGroup.rxnormId[0];
            if (!rxcui) return null;

            let genericName = null;
            try {
                const relRes = await fetchWithTimeout(`https://rxnav.nlm.nih.gov/REST/rxcui/${rxcui}/related.json?tty=IN`);
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

    // ---------- 3. MedlinePlus Connect ----------
    async function tryMedlinePlus(rxcui) {
        try {
            const url = `https://connect.medlineplus.gov/service?mainSearchCriteria.v.cs=RXCUI&mainSearchCriteria.v.c=${rxcui}&knowledgeResponseType=application/json`;
            const res = await fetchWithTimeout(url);
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

    // ---------- 4. DailyMed official label link ----------
    // DISABLED: confirmed CORS-blocked in production (dailymed.nlm.nih.gov
    // does not send Access-Control-Allow-Origin), so this always fails.
    // Kept as a no-op stub so the rest of the code doesn't need to change.
    async function tryDailyMed(name) {
        return null;
    }

    // ---------- 5. PubChem chemistry ----------
    async function tryPubChem(name) {
        try {
            const url = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(name)}/property/MolecularFormula,MolecularWeight,IUPACName/JSON`;
            const res = await fetchWithTimeout(url);
            if (!res.ok) return null;
            const json = await res.json();
            const props = json.PropertyTable && json.PropertyTable.Properties && json.PropertyTable.Properties[0];
            if (!props) return null;
            return {
                formula: props.MolecularFormula || null,
                weight: props.MolecularWeight || null,
                iupacName: props.IUPACName || null
            };
        } catch (e) {
            return null;
        }
    }

    // ---------- 6. ClinicalTrials.gov research studies ----------
    async function tryClinicalTrials(name) {
        try {
            const url = `https://clinicaltrials.gov/api/v2/studies?query.term=${encodeURIComponent(name)}&pageSize=3&fields=NCTId,BriefTitle,OverallStatus`;
            const res = await fetchWithTimeout(url);
            if (!res.ok) return null;
            const json = await res.json();
            const studies = json.studies;
            if (!studies || !studies.length) return null;
            return studies.map(s => {
                const m = s.protocolSection && s.protocolSection.identificationModule;
                const st = s.protocolSection && s.protocolSection.statusModule;
                const nctId = m && m.nctId;
                return {
                    title: m && m.briefTitle,
                    status: st && st.overallStatus,
                    link: nctId ? `https://clinicaltrials.gov/study/${nctId}` : null
                };
            }).filter(s => s.title);
        } catch (e) {
            return null;
        }
    }

    // ---------- 7. openFDA real-world adverse events ----------
    async function tryTopReactions(name) {
        try {
            const url = `https://api.fda.gov/drug/event.json?search=patient.drug.medicinalproduct:"${name}"&count=patient.reaction.reactionmeddrapt.exact&limit=5`;
            const res = await fetchWithTimeout(url);
            if (!res.ok) return null;
            const json = await res.json();
            if (!json.results || !json.results.length) return null;
            return json.results.map(r => ({ term: r.term, count: r.count }));
        } catch (e) {
            return null;
        }
    }

    // ---------- 8. openFDA recalls / safety alerts ----------
    async function tryRecall(name) {
        try {
            const url = `https://api.fda.gov/drug/enforcement.json?search=product_description:"${name}"&limit=1&sort=report_date:desc`;
            const res = await fetchWithTimeout(url);
            if (!res.ok) return null;
            const json = await res.json();
            const r = json.results && json.results[0];
            if (!r) return null;
            return {
                reason: r.reason_for_recall,
                status: r.status,
                date: r.report_date
            };
        } catch (e) {
            return null;
        }
    }

    // ---------- 9. ChEMBL (EMBL-EBI) mechanism of action ----------
    // DISABLED: confirmed CORS-blocked in production (www.ebi.ac.uk does
    // not send Access-Control-Allow-Origin for browser fetch), so this
    // always fails. Kept as a no-op stub so nothing else needs to change.
    async function tryChEMBL(name) {
        return null;
    }

    // ---------- 10. openFDA NDC Directory (manufacturer/route/form) ----------
    async function tryNDC(name) {
        try {
            const url = `https://api.fda.gov/drug/ndc.json?search=generic_name:"${name}"+OR+brand_name:"${name}"&limit=1`;
            const res = await fetchWithTimeout(url);
            if (!res.ok) return null;
            const json = await res.json();
            const r = json.results && json.results[0];
            if (!r) return null;
            return {
                manufacturer: r.labeler_name || null,
                route: r.route ? r.route.join(", ") : null,
                dosageForm: r.dosage_form || null
            };
        } catch (e) {
            return null;
        }
    }

    // ---------- 11. PubMed (NCBI) related research articles ----------
    async function tryPubMed(name) {
        try {
            const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&retmax=3&term=${encodeURIComponent(name)}`;
            const searchRes = await fetchWithTimeout(searchUrl);
            if (!searchRes.ok) return null;
            const searchJson = await searchRes.json();
            const ids = searchJson.esearchresult && searchJson.esearchresult.idlist;
            if (!ids || !ids.length) return null;

            const summaryUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json&id=${ids.join(",")}`;
            const summaryRes = await fetchWithTimeout(summaryUrl);
            if (!summaryRes.ok) return null;
            const summaryJson = await summaryRes.json();

            return ids.map(id => {
                const item = summaryJson.result && summaryJson.result[id];
                if (!item) return null;
                return {
                    title: item.title,
                    link: `https://pubmed.ncbi.nlm.nih.gov/${id}/`
                };
            }).filter(Boolean);
        } catch (e) {
            return null;
        }
    }

    // ---------- Free translation (English → Hindi), no API key ----------
    // Tries Google's public translate endpoint first (best quality),
    // falls back to MyMemory (documented free API) if that fails.
    async function translateToHindi(text) {
        if (!text) return null;
        const trimmed = text.length > 450 ? text.substring(0, 450) : text;

        try {
            const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=hi&dt=t&q=${encodeURIComponent(trimmed)}`;
            const res = await fetchWithTimeout(url);
            if (res.ok) {
                const json = await res.json();
                const translated = json && json[0] ? json[0].map(chunk => chunk[0]).join("") : null;
                if (translated) return translated;
            }
        } catch (e) { /* fall through to backup */ }

        try {
            const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(trimmed)}&langpair=en|hi`;
            const res = await fetchWithTimeout(url);
            if (res.ok) {
                const json = await res.json();
                return (json.responseData && json.responseData.translatedText) || null;
            }
        } catch (e) { /* ignore */ }

        return null;
    }

    /**
     * Enrichment: fetched in parallel, best-effort, never blocks
     * the main answer (any of these can be null).
     */
    async function fetchExtras(name) {
        const [dailymed, chemistry, trials, topReactions, recall, mechanism, ndc, articles] = await Promise.all([
            tryDailyMed(name),
            tryPubChem(name),
            tryClinicalTrials(name),
            tryTopReactions(name),
            tryRecall(name),
            tryChEMBL(name),
            tryNDC(name),
            tryPubMed(name)
        ]);
        return { dailymed, chemistry, trials, topReactions, recall, mechanism, ndc, articles };
    }

    // Common India/International generic names that differ from the US
    // name openFDA actually uses. Checked first so these always resolve
    // correctly instead of depending on RxNorm's inconsistent mapping.
    const NAME_SYNONYMS = {
        "paracetamol": "acetaminophen",
        "salbutamol": "albuterol",
        "frusemide": "furosemide",
        "adrenaline": "epinephrine",
        "noradrenaline": "norepinephrine",
        "diclofenac sodium": "diclofenac",
        "meropenem": "meropenem",
        "cetirizine hydrochloride": "cetirizine",
        "domperidone": "domperidone",
        "pantoprazole sodium": "pantoprazole"
    };

    /**
     * Main entry point.
     * Returns a normalized object:
     * {
     *   source: 'openfda' | 'openfda-rxnorm' | 'openfda-synonym' | 'medlineplus' | null,
     *   name: string,
     *   fda: <raw openFDA label result> | null,
     *   medline: [{title, link}] | null,
     *   extras: { dailymed, chemistry, trials, topReactions, recall }
     * }
     * Returns null if nothing found anywhere.
     */
    async function fetchDrugInfo(rawName) {
        const name = rawName.trim().toLowerCase();
        if (!name) return null;

        // 0. Known US-naming synonym (e.g. paracetamol -> acetaminophen)
        if (NAME_SYNONYMS[name]) {
            const usName = NAME_SYNONYMS[name];
            const synonymHit = await tryOpenFDA(usName);
            if (synonymHit) {
                const extras = await fetchExtras(usName);
                return { source: 'openfda-synonym', name: usName, fda: synonymHit, medline: null, extras };
            }
        }

        // 1. Direct openFDA
        const direct = await tryOpenFDA(name);
        if (direct) {
            const extras = await fetchExtras(name);
            return { source: 'openfda', name, fda: direct, medline: null, extras };
        }

        // 2. Normalize via RxNorm, retry openFDA with generic name
        const rx = await rxNormalize(name);
        if (rx && rx.genericName) {
            const retry = await tryOpenFDA(rx.genericName.toLowerCase());
            if (retry) {
                const extras = await fetchExtras(rx.genericName.toLowerCase());
                return { source: 'openfda-rxnorm', name: rx.genericName, fda: retry, medline: null, extras };
            }
        }

        // 3. MedlinePlus fallback (consumer-friendly info)
        if (rx && rx.rxcui) {
            const medline = await tryMedlinePlus(rx.rxcui);
            if (medline) {
                const finalName = rx.genericName || name;
                const extras = await fetchExtras(finalName);
                return { source: 'medlineplus', name: finalName, fda: null, medline, extras };
            }
        }

        // 4. Last resort — chemistry/trials may still know this name
        //    even when openFDA/RxNorm/MedlinePlus have nothing.
        const extras = await fetchExtras(name);
        if (extras.chemistry || (extras.trials && extras.trials.length) || (extras.articles && extras.articles.length)) {
            return { source: 'extras-only', name, fda: null, medline: null, extras };
        }

        return null;
    }

    return { fetchDrugInfo, translateToHindi };
})();
