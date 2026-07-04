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

async function addLevelCard(levelID) {
    const levelCardFragment = levelCardTemplate.content.cloneNode(true);
    const levelCard = levelCardFragment.querySelector(".level-card");
    
    recommendationsContainer.append(levelCardFragment);
    startAnimation(levelCard, "slide-right-and-fade-in");
}

async function displayRecommendations(username, minTier, maxTier) {
    try {
        dataCollection.resetDataManager();

        const levelRecs = await dataCollection.getRecommendations(username, minTier, maxTier);

        for (const levelID of levelRecs) {
            await addLevelCard(levelID);
            console.log(`creating card for level ID: ${levelID}`);
        }

    } catch (err) {
        errorMsg(err.message);

    }
}

/**
 * 
 * @param {string} string 
 * @param {number} min 
 * @param {number} max 
 * @returns 
 */
function purifyInt(string, min = -Infinity, max = Infinity) {
    let float = parseFloat(string);
    float = Math.max(Math.min(float, max), min);
    return (isNaN(float) ? min : Math.round(float));
}

/**
 * 
 * @param {FormData} formData 
 * @returns 
 */
function purifyFormData(formData) {
    const purifiedData = {
        minTier: dataCollection.DEFAULT_MIN_TIER,
        maxTier: dataCollection.DEFAULT_MAX_TIER,
        username: ""
    }

    purifiedData.username = formData.get("username").trim();

    if (purifiedData.username === "") {
        throw new Error("Username can't be blank!");

    }

    purifiedData.minTier = purifyInt(formData.get("min-tier"), dataCollection.DEFAULT_MIN_TIER, dataCollection.DEFAULT_MAX_TIER);
    purifiedData.maxTier = purifyInt(formData.get("max-tier"), dataCollection.DEFAULT_MIN_TIER, dataCollection.DEFAULT_MAX_TIER);

    return purifiedData;
}

// elements
const levelCardTemplate = document.getElementById("level-card-template");

const form = document.getElementById("form");
const submitButton = document.getElementById("submit-button");
const usernameField = document.getElementById("username-field");

const recommendationsContainer = document.getElementById("recommendations-container");

const errorMessageText = document.getElementById("error-message-text");

// element listeners
form.addEventListener("submit", async (event) => {
    event.preventDefault();

    try {
        const formData = purifyFormData(new FormData(form));
    
        await displayRecommendations(formData.username, formData.minTier, formData.maxTier);

    } catch (err) {
        errorMsg(err.message);

    }
});

tick(0);
