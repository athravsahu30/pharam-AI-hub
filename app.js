document.addEventListener("DOMContentLoaded", function() {
    console.log("PharmaAI Hub: System Initialized (openFDA + RxNorm + MedlinePlus).");

    let searchButton = document.getElementById("searchBtn");
    let inputBox = document.getElementById("drugInput");
    let resultArea = document.getElementById("resultText");

    async function runSearch() {
        let drugName = inputBox.value.trim();

        if (drugName === "") {
            resultArea.style.color = "#FF6B6B";
            resultArea.innerHTML = "Please pehle kisi drug ka naam type karein!";
            return;
        }

        // Animated loading state
        resultArea.style.color = "#7AB0FF";
        resultArea.innerHTML = `<span class="spinner"></span>&nbsp; Searching for: <strong>${drugName}</strong>…`;
        searchButton.disabled = true;

        const info = await PharmaData.fetchDrugInfo(drugName);

        searchButton.disabled = false;

        if (!info) {
            resultArea.style.color = "#FF6B6B";
            resultArea.innerHTML = "❌ Sorry, yeh drug kisi bhi free database (openFDA / RxNorm / MedlinePlus) mein nahi mila. Spelling check karein ya generic naam try karein (Jaise: Ibuprofen, Aspirin, Amoxicillin).";
            return;
        }

        resultArea.style.color = "#EAF0FB";

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
            `;
        }
    }

    searchButton.addEventListener("click", runSearch);
    inputBox.addEventListener("keydown", function (e) {
        if (e.key === "Enter") runSearch();
    });
});
