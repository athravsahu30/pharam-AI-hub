document.addEventListener("DOMContentLoaded", function() {
    console.log("PharmaAI Hub: System Initialized with API.");

    let searchButton = document.getElementById("searchBtn");
    let inputBox = document.getElementById("drugInput");
    let resultArea = document.getElementById("resultText");

    searchButton.addEventListener("click", async function() {
        let drugName = inputBox.value.trim().toLowerCase();

        if (drugName === "") {
            resultArea.style.color = "red";
            resultArea.innerHTML = "Please pehle kisi drug ka naam type karein!";
            return;
        }

        // Loading state (Jab data dhoondh raha ho)
        resultArea.style.color = "#0056b3";
        resultArea.innerHTML = "Searching OpenFDA database for: " + drugName + "... ⏳";

        try {
            // Asli API Call - OpenFDA se data mangwa rahe hain
            let response = await fetch(`https://api.fda.gov/drug/label.json?search=openfda.generic_name:"${drugName}"+OR+openfda.brand_name:"${drugName}"&limit=1`);
            
            // Agar dawa nahi mili
            if (!response.ok) {
                throw new Error("Drug not found");
            }

            let data = await response.json();
            let drugData = data.results[0];

            // Data ko alag-alag nikalna (Indications aur ADR)
            let indications = drugData.indications_and_usage ? drugData.indications_and_usage[0] : "Data not available.";
            let adr = drugData.adverse_reactions ? drugData.adverse_reactions[0] : "Data not available.";

            // Screen par result dikhana
            resultArea.style.color = "black";
            resultArea.innerHTML = `
                <strong style="color: green;">✅ Match Found: ${drugName.toUpperCase()}</strong><br><br>
                <strong>Uses (Indications):</strong> ${indications.substring(0, 250)}...<br><br>
                <strong>Adverse Reactions (ADR):</strong> ${adr.substring(0, 250)}...<br><br>
                <span style="font-size: 12px; color: gray;">Live Data Source: US FDA (OpenFDA API)</span>
            `;

        } catch (error) {
            // Agar error aaye ya dawa database mein na ho
            resultArea.style.color = "red";
            resultArea.innerHTML = "❌ Sorry, yeh drug OpenFDA database mein nahi mila. Spelling check karein ya dusra naam try karein (Jaise: Ibuprofen, Aspirin).";
        }
    });
});
