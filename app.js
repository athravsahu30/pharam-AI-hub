// Jab poori website load ho jaye, tab yeh code chalega
document.addEventListener("DOMContentLoaded", function() {
    console.log("PharmaAI Hub: System Initialized.");

    // HTML ke box aur button ko JavaScript se connect kar rahe hain
    let searchButton = document.getElementById("searchBtn");
    let inputBox = document.getElementById("drugInput");
    let resultArea = document.getElementById("resultText");

    // Jab 'Search' button par click hoga, tab kya karna hai:
    searchButton.addEventListener("click", function() {
        
        let drugName = inputBox.value; // User ne box mein jo likha hai, usko uthao

        // Agar user ne sach mein kuch likha hai (box khali nahi hai)
        if (drugName !== "") {
            resultArea.style.color = "green";
            resultArea.innerText = "Searching database for: " + drugName + "... (AI Feature coming soon!)";
        } 
        // Agar user ne bina kuch likhe button daba diya
        else {
            resultArea.style.color = "red";
            resultArea.innerText = "Please pehle kisi drug ka naam type karein!";
        }
    });
});
