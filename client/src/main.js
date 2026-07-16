import * as dataCollection from "./data-collection.js";
import {formatter, getNBest, purifyInt, reverseMap, sleep} from "../../utils.js";

const CLIENT_TICK_DELAY = 50; // milliseconds

const MAX_GRADIENT_DISTANCE = 80; // percent
const MIN_GRADIENT_DISTANCE = 20; // percent

const LEVEL_CARD_DELAY = 500; // milliseconds

function tick(numTicks) {
    let newTicks = numTicks + 1;

    // track various dataManager values here
    switch (dataCollection.trackers.progressState) {
        case dataCollection.PROGRESS.STAGE_1:
            dataCollection.trackers.progressValue = window.dataManager.mainUserEnjProfile.ratingMap.size;
            progressValueText.textContent = `(${dataCollection.trackers.progressValue})`;
            break;
        
        case dataCollection.PROGRESS.STAGE_2:
            dataCollection.trackers.progressValue = window.dataManager.otherUserEnjProfileMap.size;
            progressValueText.textContent = `(${dataCollection.trackers.progressValue})`;
            break;

        case dataCollection.PROGRESS.STAGE_4:
            dataCollection.trackers.progressValue = window.dataManager.cachedLevelInfo.size;
            progressValueText.textContent = `(${dataCollection.trackers.progressValue})`;
            break;

        case dataCollection.PROGRESS.DONE:
            dataCollection.trackers.progressValue = dataCollection.trackers.totalTimeElapsed;
            progressValueText.textContent = `(${dataCollection.trackers.progressValue} ms)`;
            break;

        default:
            dataCollection.trackers.progressValue = 0;
            progressValueText.textContent = ``;
            break;

    }

    progressMessageText.textContent = dataCollection.trackers.progressState;

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
 * @param {boolean} hideOnceFinished 
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

function breakDownWeightCalculations(levelWeightInfo) {
    const numUsers = levelWeightInfo.numRatings;
    const rawAvgWeight = levelWeightInfo.rawTotalWeight * 1.0 / numUsers;

    const userCountMultiplier = levelWeightInfo.weight / rawAvgWeight;
    const userCountPenalty = levelWeightInfo.weight - rawAvgWeight;

    const compatWeight = rawAvgWeight / levelWeightInfo.skillMultiplier;
    const skillWeight = rawAvgWeight - compatWeight;

    const resultWeight = levelWeightInfo.weight;

    return `Raw Weight: ${formatter.format(rawAvgWeight)}
    Similiar Users Weight: ${formatter.format(compatWeight)}
    Skill Weight: ${formatter.format(skillWeight)} (multiplier: ${formatter.format(levelWeightInfo.skillMultiplier)}x)
User Count Penalty: ${formatter.format(userCountPenalty)} (${numUsers} users) (multiplier: ${formatter.format(userCountMultiplier)}x)

Result Weight: ${formatter.format(resultWeight)}`;
}

/**
 * 
 * @param {number} levelID 
 * @param {{rawTotalWeight: number, weight: number, numRatings: number, skillMultiplier: number, levelInfo: {
 *          actualRating: number, actualEnj: number, levelName: string, levelAuthor: string, skills2DArr: [string, number][]
 *        }}} levelWeightInfo 
 */
async function addLevelCard(levelID, levelWeightInfo) {
    const levelInfo = levelWeightInfo.levelInfo;

    const levelCardFragment = levelCardTemplate.content.cloneNode(true);
    const levelCard = levelCardFragment.querySelector(".level-card");

    const skillCard = levelCardFragment.querySelector(".skills-display");
    const levelName = levelCardFragment.querySelector(".level-name");
    const levelIDText = levelCardFragment.querySelector(".level-id");
    const authorName = levelCardFragment.querySelector(".author-name");
    const tier = levelCardFragment.querySelector(".tier");
    const enj = levelCardFragment.querySelector(".enjoyment");

    const recInfo = levelCardFragment.querySelector(".rec-info");
    const trashRec = levelCardFragment.querySelector(".trash-rec");
    const showcase = levelCardFragment.querySelector(".showcase");
    const gddlLink = levelCardFragment.querySelector(".gddl-link");

    const {
        actualRating: tierValue, 
        actualEnj: enjValue, 
        levelName: name, 
        levelAuthor: author, 
        skills2DArr: skillsArr
    } = levelInfo;

    levelIDText.textContent = levelID;

    const mapToSkillName = reverseMap(dataCollection.SKILLS_MAPPING);
    const top3Skills = getNBest(skillsArr, 3, (kvp) => -kvp[1]);
    let skillsString = top3Skills.map(elem => mapToSkillName.get(elem[0])).join(", ");

    if (skillsString === "") {
        skillsString += "No skills found";
    }

    skillCard.textContent = skillsString;

    levelName.textContent = name;
    authorName.textContent = author;
    tier.textContent = Math.round(tierValue);
    enj.textContent = Math.round(enjValue);

    if (authorName.textContent == null) {
        const author = levelCardFragment.querySelector(".author");
        author.style.setProperty("display", "none");
    }

    recInfo.title = breakDownWeightCalculations(levelWeightInfo);
    trashRec.addEventListener("click", async () => {
        const newLevelRec = dataCollection.getNextRecommendation();

        if (newLevelRec != null) {
            await replaceLevelCard(levelCard, newLevelRec[0], newLevelRec[1]);

        } else {
            await replaceLevelCard(levelCard, null, null)

        }
    })
    gddlLink.addEventListener("click", () => {
        window.open(`https://gdladder.com/level/${levelID}`, "_blank");
    });
    dataCollection.requestLevelShowcaseGDDL(levelID).then((showcaseID) => {
        if (showcaseID != null) {
            showcase.addEventListener("click", () => {
                window.open(`https://www.youtube.com/watch?v=${showcaseID}`, "_blank");
            });
            showcase.classList.toggle("cursor-pointer", true);

        } else {
            showcase.title = "No video was found for this level";

        }

    }).catch((err) => {
        showcase.title = "No video was found for this level";

    });

    recommendationsContainer.append(levelCardFragment);
    startAnimation(levelCard, "slide-right-and-fade-in");
}

async function replaceLevelCard(oldLevelCard, newLevelID, newLevelWeightInfo) {
    oldLevelCard.style.setProperty("display", "none");

    if (newLevelID != null && newLevelWeightInfo != null) {
        await addLevelCard(newLevelID, newLevelWeightInfo);
    }
}

async function displayRecommendations(username, minTier, maxTier, skillWeightPref) {
    dataCollection.resetDataManager();
    recommendationsContainer.style.setProperty("display", "none");
    recommendationsContainer.replaceChildren();

    disclaimer.style.setProperty("display", "block");
    const levelRecs = await dataCollection.getRecommendations(username, minTier, maxTier, skillWeightPref);
    disclaimer.style.setProperty("display", "none");
    recommendationsContainer.style.setProperty("display", "grid");

    const h2 = document.createElement("h2");
    h2.textContent = (levelRecs.length > 0) ? "Your recommended levels" : "Wasn't able to get any recommendations :(";
    recommendationsContainer.append(h2);
    startAnimation(h2, "slide-right-and-fade-in");
    await sleep(LEVEL_CARD_DELAY);

    for (const [levelID, levelWeightInfo] of levelRecs) {
        addLevelCard(levelID, levelWeightInfo);
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
        username: "",
        skillWeightPref: "MATCH"
    }

    purifiedData.username = formData.get("username").trim();

    if (purifiedData.username === "") {
        throw new Error("Username can't be blank!");

    }

    purifiedData.minTier = purifyInt(formData.get("min-tier"), dataCollection.DEFAULT_MIN_TIER, dataCollection.DEFAULT_MIN_TIER, dataCollection.DEFAULT_MAX_TIER);
    purifiedData.maxTier = purifyInt(formData.get("max-tier"), dataCollection.DEFAULT_MAX_TIER, dataCollection.DEFAULT_MIN_TIER, dataCollection.DEFAULT_MAX_TIER);

    if (formData.get("match-skills") != null) {
        purifiedData.skillWeightPref = "MATCH";

    } else {
        purifiedData.skillWeightPref = "NONE";

    }

    return purifiedData;
}

// elements
const levelCardTemplate = document.getElementById("level-card-template");

const form = document.getElementById("form");
const submitButton = document.getElementById("submit-button");
const usernameField = document.getElementById("username-field");

const recommendationsContainer = document.getElementById("recommendations-container");

const disclaimer = document.getElementById("disclaimer");
const errorMessageText = document.getElementById("error-message-text");
const progressMessageText = document.getElementById("progress-message-text");
const progressValueText = document.getElementById("progress-value-text");

// element listeners
form.addEventListener("submit", async (event) => {
    event.preventDefault();

    try {
        const formData = purifyFormData(new FormData(form));
    
        await displayRecommendations(formData.username, formData.minTier, formData.maxTier, formData.skillWeightPref);

    } catch (err) {
        errorMsg(err.message);
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