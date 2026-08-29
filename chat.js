document.addEventListener("DOMContentLoaded", function() {
    let sendBtn = document.getElementById("sendBtn");
    let userInput = document.getElementById("userInput");
    let chatBox = document.getElementById("chatBox");

    // Message screen par dikhane ka function
    function addMessage(text, sender) {
        let msgDiv = document.createElement("div");
        msgDiv.classList.add("message");
        msgDiv.classList.add(sender === "user" ? "user-msg" : "bot-msg");
        msgDiv.innerText = text;
        chatBox.appendChild(msgDiv);
        chatBox.scrollTop = chatBox.scrollHeight; // Auto-scroll
    }

    // Varied messages ki list taaki bot natural lage
    const thinkingMessages = [
        "Let me check my database for that...",
        "Analyzing your query...",
        "Pulling up the latest pharmacological data...",
        "Just a second, retrieving information..."
    ];

    sendBtn.addEventListener("click", function() {
        let text = userInput.value.trim();
        if (text === "") return;

        // 1. User ka message dikhana
        addMessage(text, "user");
        userInput.value = "";

        // 2. Natural aur varied response dikhana
        let randomThinking = thinkingMessages[Math.floor(Math.random() * thinkingMessages.length)];
        addMessage(randomThinking, "bot");

        // 3. AI Placeholder (Real AI agle step mein aayega)
        setTimeout(() => {
             addMessage("✅ This is a test! Message received: '" + text + "'. In the next step, we will connect the real AI to answer this properly.", "bot");
        }, 1500);
    });
});
