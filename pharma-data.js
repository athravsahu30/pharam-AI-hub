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
   ========================================================== */

const PharmaData = (function () {

    // ---------- 1. openFDA drug label ----------
    async function tryOpenFDA(name) {
        try {
            const url = `https://api.fda.gov/drug/label.json?search=openfda.generic_name:"${name}"+OR+openfda.brand_name:"${name}"&limit=1`;
            const res = await fetch(url);
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

    // ---------- 3. MedlinePlus Connect ----------
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

    // ---------- 4. DailyMed official label link ----------
    async function tryDailyMed(name) {
        try {
            const res = await fetch(`https://dailymed.nlm.nih.gov/dailymed/services/v2/spls.json?drug_name=${encodeURIComponent(name)}&pagesize=1`);
            if (!res.ok) return null;
            const json = await res.json();
            const first = json.data && json.data[0];
            if (!first || !first.setid) return null;
            return {
                title: first.title,
                link: `https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=${first.setid}`
            };
        } catch (e) {
            return null;
        }
    }

    // ---------- 5. PubChem chemistry ----------
    async function tryPubChem(name) {
        try {
            const url = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(name)}/property/MolecularFormula,MolecularWeight,IUPACName/JSON`;
            const res = await fetch(url);
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
            const res = await fetch(url);
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
            const res = await fetch(url);
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
            const res = await fetch(url);
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

    /**
     * Enrichment: fetched in parallel, best-effort, never blocks
     * the main answer (any of these can be null).
     */
    async function fetchExtras(name) {
        const [dailymed, chemistry, trials, topReactions, recall] = await Promise.all([
            tryDailyMed(name),
            tryPubChem(name),
            tryClinicalTrials(name),
            tryTopReactions(name),
            tryRecall(name)
        ]);
        return { dailymed, chemistry, trials, topReactions, recall };
    }

    /**
     * Main entry point.
     * Returns a normalized object:
     * {
     *   source: 'openfda' | 'openfda-rxnorm' | 'medlineplus' | null,
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

        // 4. Last resort — chemistry/trials/DailyMed may still know this name
        //    even when openFDA/RxNorm/MedlinePlus have nothing.
        const extras = await fetchExtras(name);
        if (extras.dailymed || extras.chemistry || (extras.trials && extras.trials.length)) {
            return { source: 'extras-only', name, fda: null, medline: null, extras };
        }

        return null;
    }

    return { fetchDrugInfo };
})();
