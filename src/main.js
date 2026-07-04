import * as dataCollection from "./data-collection.js";
import {purifyInt, reverseMap} from "./utils.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const CLIENT_TICK_DELAY = 50; // milliseconds

const MAX_GRADIENT_DISTANCE = 80; // percent
const MIN_GRADIENT_DISTANCE = 20; // percent

const LEVEL_CARD_DELAY = 500; // milliseconds

function tick(numTicks) {
    let newTicks = numTicks + 1;

    // restarts the timer
    setTimeout(() => {
        tick(newTicks);
    }, CLIENT_TICK_DELAY);
}

export let targetGradientX = 50; // percent

const root = document.documentElement;

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

async function addLevelCard(levelID, levelInfo) {
    const levelCardFragment = levelCardTemplate.content.cloneNode(true);
    const levelCard = levelCardFragment.querySelector(".level-card");
    const skillCard = levelCardFragment.querySelector(".skills-display");
    const levelName = levelCardFragment.querySelector(".level-name");

    dataCollection.getLevelSkills(levelID, 3).then(arr => {
        const mapToSkillName = reverseMap(dataCollection.SKILLS_MAPPING);
        let skillsString = arr.map(elem => mapToSkillName.get(elem[0])).join(", ");

        if (skillsString === "") {
            skillsString += "No skills found";
        }

        skillCard.textContent = skillsString;
    });

    levelName.textContent = levelInfo.levelName;

    recommendationsContainer.append(levelCardFragment);
    startAnimation(levelCard, "slide-right-and-fade-in");
}

async function displayRecommendations(username, minTier, maxTier) {
    dataCollection.resetDataManager();
    recommendationsContainer.style.setProperty("display", "none");
    recommendationsContainer.replaceChildren();

    const levelRecs = await dataCollection.getRecommendations(username, minTier, maxTier);
    recommendationsContainer.style.setProperty("display", "flex");

    const h2 = document.createElement("h2");
    h2.textContent = "Your recommended levels";
    recommendationsContainer.append(h2);
    startAnimation(h2, "slide-right-and-fade-in");
    await sleep(LEVEL_CARD_DELAY);

    for (const [levelID, levelWeightInfo] of levelRecs) {
        addLevelCard(levelID, levelWeightInfo.levelInfo);
        console.log(`creating card for level ID: ${levelID}`);
        await sleep(LEVEL_CARD_DELAY);
    }
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

    purifiedData.minTier = purifyInt(formData.get("min-tier"), dataCollection.DEFAULT_MIN_TIER, dataCollection.DEFAULT_MIN_TIER, dataCollection.DEFAULT_MAX_TIER);
    purifiedData.maxTier = purifyInt(formData.get("max-tier"), dataCollection.DEFAULT_MAX_TIER, dataCollection.DEFAULT_MIN_TIER, dataCollection.DEFAULT_MAX_TIER);

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
        throw err; // DEBUG ONLY
    }
});

// other listeners
// sets the gradient midpoint to mouse cursor location
export let gradientOnMouseMove = window.addEventListener("mousemove", (event) => {
    let xPercent = (event.clientX / window.innerWidth) * 100;
    // let yPercent = (event.clientY / window.innerHeight) * 100;

    targetGradientX = Math.max(Math.min(xPercent, MAX_GRADIENT_DISTANCE), MIN_GRADIENT_DISTANCE)
})

export let gradientLerp = setInterval(() => {
    const currentGradientX = parseFloat(window.getComputedStyle(root).getPropertyValue("--gradient-midpoint").replace("%", ""));

    root.style.setProperty("--gradient-midpoint", `${
        currentGradientX + 0.02 * (targetGradientX - currentGradientX)
    }%`);
    // console.log(`moving gradient from ${window.getComputedStyle(root).getPropertyValue("--gradient-midpoint")} (${currentGradientX}) to ${targetGradientX}`);
}, 0.33 * CLIENT_TICK_DELAY);

// start ticking    
tick(0);