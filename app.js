document.addEventListener("DOMContentLoaded", function() {
    console.log("PharmaAI Hub: System Initialized (openFDA + RxNorm + MedlinePlus + DailyMed + PubChem + ClinicalTrials).");

    let searchButton = document.getElementById("searchBtn");
    let inputBox = document.getElementById("drugInput");
    let resultArea = document.getElementById("resultText");

    function renderExtras(extras) {
        if (!extras) return "";
        let html = "";

        if (extras.recall) {
            html += `
                <div style="margin-top:14px; padding:10px 12px; border-radius:8px; background:rgba(255,107,107,0.12); border:1px solid rgba(255,107,107,0.35);">
                    <strong style="color:#FF6B6B;">⚠️ Recall/Safety Alert:</strong> ${extras.recall.reason ? extras.recall.reason.substring(0, 180) : "Details available"}
                    <div style="font-size:11px; color:#8C97B3; margin-top:4px;">Status: ${extras.recall.status || "N/A"} · openFDA Enforcement</div>
                </div>`;
        }

        if (extras.chemistry) {
            html += `<div style="margin-top:12px; font-size:13px;">
                <strong>🧪 Chemistry:</strong>
                ${extras.chemistry.formula ? `Formula: <code>${extras.chemistry.formula}</code>` : ""}
                ${extras.chemistry.weight ? ` · Molecular Weight: ${extras.chemistry.weight}` : ""}
                <span style="font-size:11px; color:#8C97B3;"> (PubChem)</span>
            </div>`;
        }

        if (extras.topReactions && extras.topReactions.length) {
            const chips = extras.topReactions.map(r =>
                `<span style="display:inline-block; margin:3px 4px 0 0; padding:3px 9px; border-radius:14px; background:rgba(76,141,255,0.14); font-size:11.5px;">${r.term.toLowerCase()} (${r.count})</span>`
            ).join("");
            html += `<div style="margin-top:12px; font-size:13px;"><strong>📊 Most-reported real-world side effects:</strong><br>${chips}<br><span style="font-size:11px; color:#8C97B3;">Source: openFDA Adverse Event Reports</span></div>`;
        }

        if (extras.trials && extras.trials.length) {
            const items = extras.trials.map(t =>
                `<li><a href="${t.link}" target="_blank" rel="noopener" style="color:#7AB0FF;">${t.title}</a> <span style="font-size:11px; color:#8C97B3;">(${t.status || "status unknown"})</span></li>`
            ).join("");
            html += `<div style="margin-top:12px; font-size:13px;"><strong>🔬 Related research studies:</strong><ul style="margin:6px 0 0 18px; padding:0;">${items}</ul><span style="font-size:11px; color:#8C97B3;">Source: ClinicalTrials.gov</span></div>`;
        }

        if (extras.dailymed) {
            html += `<div style="margin-top:12px; font-size:12.5px;">📄 <a href="${extras.dailymed.link}" target="_blank" rel="noopener" style="color:#7AB0FF;">View official FDA label on DailyMed →</a></div>`;
        }

        return html;
    }

    async function runSearch() {
        let drugName = inputBox.value.trim();

        if (drugName === "") {
            resultArea.style.color = "#FF6B6B";
            resultArea.innerHTML = "Please pehle kisi drug ka naam type karein!";
            return;
        }

        resultArea.style.color = "#7AB0FF";
        resultArea.innerHTML = `<span class="spinner"></span>&nbsp; Searching 6+ free medical databases for: <strong>${drugName}</strong>…`;
        searchButton.disabled = true;

        const info = await PharmaData.fetchDrugInfo(drugName);

        searchButton.disabled = false;

        if (!info) {
            resultArea.style.color = "#FF6B6B";
            resultArea.innerHTML = "❌ Sorry, yeh drug kisi bhi free database (openFDA / RxNorm / MedlinePlus / DailyMed / PubChem / ClinicalTrials) mein nahi mila. Spelling check karein ya generic naam try karein (Jaise: Ibuprofen, Aspirin, Amoxicillin).";
            return;
        }

        resultArea.style.color = "#EAF0FB";
        const extrasHtml = renderExtras(info.extras);

        if (info.fda) {
            const indications = info.fda.indications_and_usage ? info.fda.indications_and_usage[0] : "Data not available.";
            const adr = info.fda.adverse_reactions ? info.fda.adverse_reactions[0] : "Data not available.";
            const sourceNote = info.source === 'openfda-rxnorm'
                ? `Matched via RxNorm → generic name: <strong>${info.name.toUpperCase()}</strong>`
                : `Direct match: <strong>${info.name.toUpperCase()}</strong>`;

            resultArea.innerHTML = `
                <strong style="color: #34D399;">✅ ${sourceNote}</strong><br><br>
                <strong>Uses (Indications):</strong> ${indications.substring(0, 250)}...<br><br>
                <strong>Adverse Reactions (ADR):</strong> ${adr.substring(0, 250)}...<br><br>
                <span style="font-size: 12px; color: #8C97B3;">Live Data Source: US FDA (OpenFDA API)</span>
                ${extrasHtml}
            `;
        } else if (info.medline) {
            const items = info.medline.slice(0, 3).map(m =>
                `<li><a href="${m.link}" target="_blank" rel="noopener" style="color:#7AB0FF;">${m.title}</a></li>`
            ).join("");
            resultArea.innerHTML = `
                <strong style="color: #34D399;">✅ Match Found: ${info.name.toUpperCase()}</strong><br><br>
                FDA label data available nahi thi, lekin MedlinePlus (NIH) pe yeh mila:<br>
                <ul style="margin:8px 0 0 18px; padding:0;">${items}</ul><br>
                <span style="font-size: 12px; color: #8C97B3;">Live Data Source: MedlinePlus Connect (NIH)</span>
                ${extrasHtml}
            `;
        } else {
            resultArea.innerHTML = `
                <strong style="color: #34D399;">✅ Match Found: ${info.name.toUpperCase()}</strong><br><br>
                Poora FDA label text available nahi hai, lekin neeche di gayi info mili:
                ${extrasHtml || "<span style='color:#8C97B3;'>Limited data available.</span>"}
            `;
        }
    }

    searchButton.addEventListener("click", runSearch);
    inputBox.addEventListener("keydown", function (e) {
        if (e.key === "Enter") runSearch();
    });
});
