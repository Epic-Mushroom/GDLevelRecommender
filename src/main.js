import * as dataCollection from "./data-collection.js";

const SERVER_TICK_DELAY = 50; // milliseconds

function tick(numTicks) {
    let newTicks = numTicks + 1;

    // restarts the timer
    setTimeout(() => {
        tick(newTicks);
    }, SERVER_TICK_DELAY);
}

/**
 * 
 * @param {HTMLElement} element 
 * @param {string} className 
 * @param {boolean}} hideOnceFinished 
 */
function startAnimation(element, className, hideOnceFinished = false) {
    if (hideOnceFinished) {
        element.style.setProperty("display", "block");
        element.addEventListener("animationend", () => element.style.setProperty("display", "none"), {once: true});
    }

    element.classList.toggle(className, false);
    requestAnimationFrame(() => element.classList.toggle(className, true));
}

/**
 * 
 * @param {string} message 
 */
function errorMsg(message) {
    errorMessageText.textContent = message;
    startAnimation(errorMessageText, "display-and-fade-out", true);
}

async function displayRecommendations(username) {
    try {
        dataCollection.resetDataManager();

        const levelRecs = await dataCollection.getRecommendations(username);

    } catch (err) {
        errorMsg(err.message);

    }
}

// elements
const form = document.getElementById("form");
const submitButton = document.getElementById("submit-button");
const usernameField = document.getElementById("username-field");

const errorMessageText = document.getElementById("error-message-text");

// element listeners
form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const formData = new FormData(form);

    if (formData.get("username") === "") {
        errorMsg("Username can't be blank!");
        return;
    }

    await displayRecommendations(formData.get("username"));
});

tick(0);
