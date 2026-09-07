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

    // Given an rxcui (for either a brand, salt-form, or ingredient concept),
    // resolve it down to its plain ingredient/generic name via RxNorm's
    // "related concepts" endpoint. Shared by rxNormalize() and by the
    // spelling-correction path below, since both end up holding an rxcui
    // that needs to become a clean generic name before hitting openFDA.
    async function getIngredientName(rxcui) {
        if (!rxcui) return null;
        try {
            const relRes = await fetchWithTimeout(`https://rxnav.nlm.nih.gov/REST/rxcui/${rxcui}/related.json?tty=IN`);
            const relJson = await relRes.json();
            const group = relJson && relJson.relatedGroup && relJson.relatedGroup.conceptGroup;
            const ingredient = group && group.find(g => g.tty === 'IN');
            return (ingredient && ingredient.conceptProperties && ingredient.conceptProperties[0] && ingredient.conceptProperties[0].name) || null;
        } catch (e) {
            return null;
        }
    }

    async function rxNormalize(name) {
        try {
            const res = await fetchWithTimeout(`https://rxnav.nlm.nih.gov/REST/rxcui.json?name=${encodeURIComponent(name)}`);
            if (!res.ok) return null;
            const json = await res.json();
            const rxcui = json && json.idGroup && json.idGroup.rxnormId && json.idGroup.rxnormId[0];
            if (!rxcui) return null;

            const genericName = await getIngredientName(rxcui);
            return { rxcui, genericName };
        } catch (e) {
            return null;
        }
    }

    // ---------- 2b. RxNorm approximate match — spelling correction ----------
    // Catches typos ("paracetmol", "amoxicilin", "ibuprofn", "azithromicin")
    // that fail the exact-match lookups above. RxNorm's approximateTerm
    // endpoint runs a fuzzy search across its whole drug vocabulary and
    // returns ranked candidates with a match score.
    async function rxSpellCorrect(name) {
        try {
            const url = `https://rxnav.nlm.nih.gov/REST/approximateTerm.json?term=${encodeURIComponent(name)}&maxEntries=5`;
            const res = await fetchWithTimeout(url);
            if (!res.ok) return null;
            const json = await res.json();
            const candidates = json && json.approximateGroup && json.approximateGroup.candidate;
            if (!candidates || !candidates.length) return null;

            // Prefer the top-ranked candidate that actually has an rxcui.
            const best = candidates.find(c => (c.rank === '1' || c.rank === 1) && c.rxcui) || candidates.find(c => c.rxcui);
            if (!best || !best.rxcui) return null;

            let correctedName = best.name || null;
            if (!correctedName) {
                try {
                    const propRes = await fetchWithTimeout(`https://rxnav.nlm.nih.gov/REST/rxcui/${best.rxcui}/properties.json`);
                    const propJson = await propRes.json();
                    correctedName = propJson && propJson.properties && propJson.properties.name;
                } catch (e) { /* ignore */ }
            }
            if (!correctedName) return null;

            return { rxcui: best.rxcui, name: correctedName, score: best.score };
        } catch (e) {
            return null;
        }
    }

    // ---------- Local fuzzy matching (Levenshtein) ----------
    // Used to catch misspellings of the brand/generic-synonym names we
    // already keep locally (BRAND_SYNONYMS / NAME_SYNONYMS) without a
    // network round trip. RxNorm's approximate match (above) handles the
    // long tail of everything else.
    function levenshtein(a, b) {
        const m = a.length, n = b.length;
        if (m === 0) return n;
        if (n === 0) return m;
        const dp = new Array(n + 1);
        for (let j = 0; j <= n; j++) dp[j] = j;
        for (let i = 1; i <= m; i++) {
            let prev = dp[0];
            dp[0] = i;
            for (let j = 1; j <= n; j++) {
                const temp = dp[j];
                dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
                prev = temp;
            }
        }
        return dp[n];
    }

    function fuzzyMatchLocalMap(term, map) {
        if (!term) return null;
        if (map[term]) return term; // exact hit — no fuzziness needed
        let best = null;
        let bestDist = Infinity;
        for (const key of Object.keys(map)) {
            // Allow roughly one typo per 5 characters, minimum of 1.
            const threshold = Math.max(1, Math.floor(key.length / 5));
            const dist = levenshtein(term, key);
            if (dist <= threshold && dist < bestDist) {
                best = key;
                bestDist = dist;
            }
        }
        return best;
    }

    // Strips punctuation, dosage numbers/units, and dosage-form words so
    // brand-name matching works on things like "Dolo 650", "Crocin 500mg
    // Tablet", or "Combiflam Tab" the same way it works on "Dolo".
    function cleanForLookup(raw) {
        return String(raw || "")
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, " ")
            .replace(/\b\d+(\.\d+)?\s?(mg|mcg|ml|g|iu)?\b/g, " ")
            .replace(/\b(tablet|tablets|tab|tabs|capsule|capsules|cap|caps|syrup|injection|inj|drops|cream|ointment|gel|solution|suspension|sachet)\b/g, " ")
            .replace(/\s+/g, " ")
            .trim();
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

    // Common India/International generic (INN/BAN) names that differ from
    // the US Adopted Name (USAN) openFDA actually indexes under, plus
    // common salt-form suffixes that openFDA's exact-match search won't
    // strip on its own. Checked first so these always resolve correctly
    // instead of depending on RxNorm's inconsistent mapping.
    const NAME_SYNONYMS = {
        "paracetamol": "acetaminophen",
        "salbutamol": "albuterol",
        "levosalbutamol": "levalbuterol",
        "frusemide": "furosemide",
        "adrenaline": "epinephrine",
        "noradrenaline": "norepinephrine",
        "diclofenac sodium": "diclofenac",
        "diclofenac potassium": "diclofenac",
        "cetirizine hydrochloride": "cetirizine",
        "pantoprazole sodium": "pantoprazole",
        "amoxycillin": "amoxicillin",
        "amoxycillin trihydrate": "amoxicillin",
        "amoxicillin trihydrate": "amoxicillin",
        "sulphamethoxazole": "sulfamethoxazole",
        "chlorhexidine gluconate": "chlorhexidine",
        "levothyroxine sodium": "levothyroxine",
        "metoprolol tartrate": "metoprolol",
        "metoprolol succinate": "metoprolol",
        "omeprazole magnesium": "omeprazole",
        "esomeprazole magnesium": "esomeprazole",
        "azithromycin dihydrate": "azithromycin",
        "ciprofloxacin hydrochloride": "ciprofloxacin",
        "ranitidine hydrochloride": "ranitidine",
        "metformin hydrochloride": "metformin",
        "atorvastatin calcium": "atorvastatin",
        "rosuvastatin calcium": "rosuvastatin",
        "amlodipine besylate": "amlodipine",
        "amlodipine besilate": "amlodipine",
        "losartan potassium": "losartan",
        "telmisartan": "telmisartan",
        "ondansetron hydrochloride": "ondansetron",
        "tramadol hydrochloride": "tramadol",
        "diphenhydramine hydrochloride": "diphenhydramine",
        "mefenamic acid": "mefenamic acid",
        "aceclofenac": "aceclofenac",
        "clavulanic acid": "clavulanate"
    };

    // Common Indian/international BRAND names mapped to their primary
    // active-ingredient generic name, so brand-name searches (which won't
    // exist in openFDA's largely US-market brand database) still resolve.
    // NOTE: several of these are combination products (e.g. Combiflam is
    // ibuprofen + paracetamol) — for those, the map points at one
    // representative active ingredient for lookup purposes only. This is a
    // convenience layer, not a substitute for checking the full label.
    const BRAND_SYNONYMS = {
        "dolo": "paracetamol",
        "crocin": "paracetamol",
        "calpol": "paracetamol",
        "pyrigesic": "paracetamol",
        "tylenol": "acetaminophen",
        "panadol": "paracetamol",
        "ecosprin": "aspirin",
        "disprin": "aspirin",
        "loprin": "aspirin",
        "combiflam": "ibuprofen",
        "brufen": "ibuprofen",
        "advil": "ibuprofen",
        "flexon": "ibuprofen",
        "volini": "diclofenac",
        "voveran": "diclofenac",
        "voltaren": "diclofenac",
        "zerodol": "aceclofenac",
        "meftal": "mefenamic acid",
        "naprosyn": "naproxen",
        "augmentin": "amoxicillin",
        "amoxil": "amoxicillin",
        "zithromax": "azithromycin",
        "azee": "azithromycin",
        "azithral": "azithromycin",
        "ciplox": "ciprofloxacin",
        "cifran": "ciprofloxacin",
        "norflox": "norfloxacin",
        "metrogyl": "metronidazole",
        "flagyl": "metronidazole",
        "pan": "pantoprazole",
        "pantop": "pantoprazole",
        "omez": "omeprazole",
        "prilosec": "omeprazole",
        "rantac": "ranitidine",
        "zantac": "ranitidine",
        "eltroxin": "levothyroxine",
        "thyronorm": "levothyroxine",
        "synthroid": "levothyroxine",
        "glycomet": "metformin",
        "glucophage": "metformin",
        "amaryl": "glimepiride",
        "lipitor": "atorvastatin",
        "atorva": "atorvastatin",
        "rosuvas": "rosuvastatin",
        "crestor": "rosuvastatin",
        "telma": "telmisartan",
        "losar": "losartan",
        "cozaar": "losartan",
        "amlopres": "amlodipine",
        "norvasc": "amlodipine",
        "stamlo": "amlodipine",
        "avil": "pheniramine",
        "allegra": "fexofenadine",
        "alerid": "cetirizine",
        "cetzine": "cetirizine",
        "zyrtec": "cetirizine",
        "claritin": "loratadine",
        "benadryl": "diphenhydramine",
        "asthalin": "albuterol",
        "levolin": "levalbuterol",
        "deriphyllin": "theophylline",
        "limcee": "ascorbic acid",
        "tramazac": "tramadol",
        "ultracet": "tramadol",
        "diclomol": "diclofenac"
    };

    /**
     * Main entry point.
     * Returns a normalized object:
     * {
     *   source: 'brand-map' | 'openfda' | 'openfda-rxnorm' | 'openfda-synonym'
     *           | 'medlineplus' | 'extras-only' | null,
     *   name: string,
     *   brandInput: string | undefined,       // original brand name typed, if any
     *   didYouMean: { from, to } | undefined,  // set when spelling was auto-corrected
     *   fda: <raw openFDA label result> | null,
     *   medline: [{title, link}] | null,
     *   extras: { dailymed, chemistry, trials, topReactions, recall, ndc, articles, mechanism }
     * }
     * Returns null if nothing found anywhere.
     *
     * `_seen` is internal — it tracks names already tried in this call chain
     * so brand-map / spelling-correction retries can't loop forever.
     */
    async function fetchDrugInfo(rawName, _seen) {
        const original = String(rawName || "").trim();
        if (!original) return null;

        const name = original.toLowerCase();
        const seen = _seen || new Set();
        if (seen.has(name)) return null;
        seen.add(name);

        const cleaned = cleanForLookup(original);

        // 0. Brand-name recognition (exact, then fuzzy for typos like
        //    "Crocine" or "Dolo 650mg"). Covers Indian/international OTC
        //    and prescription brand names that openFDA's US-centric brand
        //    database won't have.
        const brandKey = fuzzyMatchLocalMap(cleaned, BRAND_SYNONYMS);
        if (brandKey) {
            const genericTarget = BRAND_SYNONYMS[brandKey];
            const hit = await tryOpenFDA(genericTarget);
            if (hit) {
                const extras = await fetchExtras(genericTarget);
                return { source: 'brand-map', name: genericTarget, brandInput: original, fda: hit, medline: null, extras };
            }
            const viaGeneric = await fetchDrugInfo(genericTarget, seen);
            if (viaGeneric) return Object.assign({}, viaGeneric, { brandInput: original });
        }

        // 1. Known generic-name synonym (e.g. paracetamol -> acetaminophen),
        //    exact then fuzzy so a typo'd generic name still resolves.
        const synKey = fuzzyMatchLocalMap(name, NAME_SYNONYMS);
        if (synKey) {
            const usName = NAME_SYNONYMS[synKey];
            const synonymHit = await tryOpenFDA(usName);
            if (synonymHit) {
                const extras = await fetchExtras(usName);
                return { source: 'openfda-synonym', name: usName, fda: synonymHit, medline: null, extras };
            }
        }

        // 2. Direct openFDA (covers US generic names and US brand names)
        const direct = await tryOpenFDA(name);
        if (direct) {
            const extras = await fetchExtras(name);
            return { source: 'openfda', name, fda: direct, medline: null, extras };
        }

        // 3. Normalize via RxNorm, retry openFDA with generic name
        const rx = await rxNormalize(name);
        if (rx && rx.genericName) {
            const retry = await tryOpenFDA(rx.genericName.toLowerCase());
            if (retry) {
                const extras = await fetchExtras(rx.genericName.toLowerCase());
                return { source: 'openfda-rxnorm', name: rx.genericName, fda: retry, medline: null, extras };
            }
        }

        // 4. MedlinePlus fallback (consumer-friendly info)
        if (rx && rx.rxcui) {
            const medline = await tryMedlinePlus(rx.rxcui);
            if (medline) {
                const finalName = rx.genericName || name;
                const extras = await fetchExtras(finalName);
                return { source: 'medlineplus', name: finalName, fda: null, medline, extras };
            }
        }

        // 5. Spelling correction (RxNorm approximate match) — only tried
        //    once per search, and only trusted if it actually leads
        //    somewhere, so an unresolvable typo still reports "not found"
        //    instead of silently guessing.
        if (!seen.has('__spellchecked__')) {
            seen.add('__spellchecked__');
            const suggestion = await rxSpellCorrect(name);
            if (suggestion && suggestion.name && suggestion.name.toLowerCase() !== name) {
                const ingredientName = await getIngredientName(suggestion.rxcui);
                const retryTerm = ingredientName || suggestion.name;
                const viaCorrection = await fetchDrugInfo(retryTerm, seen);
                if (viaCorrection) {
                    return Object.assign({}, viaCorrection, { didYouMean: { from: original, to: retryTerm } });
                }
            }
        }

        // 6. Last resort — chemistry/trials/articles may still know this
        //    name even when openFDA/RxNorm/MedlinePlus have nothing.
        const extras = await fetchExtras(name);
        if (extras.chemistry || (extras.trials && extras.trials.length) || (extras.articles && extras.articles.length)) {
            return { source: 'extras-only', name, fda: null, medline: null, extras };
        }

        return null;
    }

    return { fetchDrugInfo, translateToHindi };
})();
