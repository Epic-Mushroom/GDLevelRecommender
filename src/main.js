import * as recs from "./recommendations.js";
import {dataManager, getRandomInt} from "./recommendations.js"

const GDDL_API_URL = "https://gdladder.com/api";
const PROXY_URL = `https://corsproxy.io/?${encodeURIComponent(GDDL_API_URL)}`;

const RATE_LIMIT_DELAY_MS = 0;

const NUM_SUBMISSIONS_PER_USER_PAGE = 25;
const NUM_SUBMISSIONS_PER_LEVEL_PAGE = 30;

const DEFAULT_MIN_TIER = 1;
const DEFAULT_MAX_TIER = 39;

// at max how many submissions per level to put into dataManager, because getting like 5,000 submissions per level is probably
// a globillion requests total and we don't want that 
const MAX_SUBMISSIONS_TO_TRACK_PER_LEVEL = 120; 
const DEFAULT_SUBMISSIONS_SORT = "dateAdded";

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

class APIError extends Error {
    /**
     * 
     * @param {number} status 
     * @param {string} message 
     */
    constructor(status, message) {
        super(message);

        this.name = "APIError";
        this.status = status;
    }
}

/**
 * 
 * @param {string} message 
 */
function errorMsg(errorMessageText, message) {
    errorMessageText.textContent = message;
}

/**
 * 
 * @param {Array<string>} pathVariables 
 * @param {Object} queryParams 
 */
async function getAPIResponse(pathVariables, queryParams, retried = false) {
    let resultURL = PROXY_URL;

    for (const variable of pathVariables) {
        resultURL += `/${encodeURIComponent(variable)}`;
    }

    const query = new URLSearchParams(queryParams).toString();
    if (query.length > 0) {
        resultURL += `?${query}`;
    }

    const response = await fetch(resultURL);

    if (!response.ok) {
        const contentType = response.headers.get("content-type");

        if (response.status === 429 && !retried) {
            console.log("rate limited... waiting 0 seconds");
            await sleep(RATE_LIMIT_DELAY_MS);
            return await getAPIResponse(pathVariables, queryParams, true);
        }

        if (contentType && contentType.includes("application/json")) {
            throw new APIError(response.status, `${response.status}: ${(await response.json()).message}`);

        } else {
            throw new APIError(response.status, `${response.status}: ${await response.text()}`);

        }
    }

    return await response.json();
}

/**
 * 
 * @param {string} username 
 */
async function getUserID(username) {
    const response = await getAPIResponse(["user", "search"], {limit: 1, name: username});

    if (response.length === 0) {
        return null;

    } else {
        return response[0].ID;
    }
}

/**
 * 
 * @param {string} username 
 */
async function getUserProfile(userID) {
    const response = await getAPIResponse(["user", userID], {});

    return response;
}

async function getLevelSubmissions(levelID, pageNum) {
    const response = await getAPIResponse(["level", levelID, "submissions"], {
        sort: DEFAULT_SUBMISSIONS_SORT,
        sortDirection: "desc",
        twoPlayer: false,
        progressFilter: "victors",
        limit: NUM_SUBMISSIONS_PER_LEVEL_PAGE,
        page: pageNum
    });

    return response;
}

/**
 * 
 * @param {string} username 
 */
async function registerUserSubmissions(userID, isOther = false, minTier = DEFAULT_MIN_TIER, maxTier = DEFAULT_MAX_TIER) {
    const userProfile = await getUserProfile(userID);    
    const numSubmissions = userProfile.SubmissionCount;
    const username = userProfile.Name;
    const numPages = Math.ceil(numSubmissions * 1.0 / NUM_SUBMISSIONS_PER_USER_PAGE);
    console.log(`attempting to register ${numSubmissions} submissions for ${username}`);

    let numSubmissionsRegistered = 0;

    for (let pageNum = 0; pageNum < numPages; pageNum++) {
        const response = await getAPIResponse(["user", userID, "submissions"], {
            minTier: minTier,
            maxTier: maxTier,
            limit: NUM_SUBMISSIONS_PER_USER_PAGE,
            page: pageNum,
            sort: "levelRating",
            sortDirection: "desc",
            onlyIncomplete: false,
            pending: false
        });

        if (response.submissions == null || response.submissions.length === 0) {
            break;
        }

        for (const submission of response.submissions) {
            // if (submission.Enjoyment == null) {
            //     continue;
            // }

            if (isOther) {
                dataManager.addOtherUserEnjRating(userID, username, submission.Level.ID, submission.Enjoyment);

            } else {
                dataManager.addMainUserEnjRating(submission.Level.ID, submission.Enjoyment);

            }

            numSubmissionsRegistered++;
        }

        console.log(`${numSubmissionsRegistered} submissions registered so far`);
    }

    console.log(`submission registration for ${username} finished: ${numSubmissionsRegistered} submissions registered`);
}

async function registerOtherUserSubmissions(minTier = DEFAULT_MIN_TIER, maxTier = DEFAULT_MAX_TIER) {
    let numTotalSubmissionsRegistered = 0;

    for (const levelID of dataManager.mainUserEnjProfile.enjMap.keys()) {
        let numSubmissionsThisLevelRegistered = 0;

        try {
            for (let pageNum = 0; pageNum < Math.ceil(MAX_SUBMISSIONS_TO_TRACK_PER_LEVEL * 1.0 / NUM_SUBMISSIONS_PER_LEVEL_PAGE); pageNum++) {
                const response = await getLevelSubmissions(levelID, pageNum);

                for (const submission of response.submissions) {
                    dataManager.addOtherUserEnjRating(submission.UserID, submission.User.Name, levelID, submission.Enjoyment);
                    numSubmissionsThisLevelRegistered++;
                    numTotalSubmissionsRegistered++;
                }
            }

        } catch (err) {
            if (err.name != "APIError") {
                throw err;
            }

            if (err.status === 429) {
                console.log(`halting gathering submissions from level ID ${levelID} due to rate limit`)
            }

        }

        console.log(`registered ${numSubmissionsThisLevelRegistered} submissions from level ID ${levelID}`);
    }

    console.log(`registered ${numTotalSubmissionsRegistered} submissions from all other users`);
}

async function getRecommendations(username, minTier = DEFAULT_MIN_TIER, maxTier = DEFAULT_MAX_TIER) {
    try {
        const userID = await getUserID(username);

        if (userID == null) {
            throw new Error("User not found!");
        }

        const userProfile = await getUserProfile(userID);
        if (userProfile.Name != username) {
            console.warn("found user's name does not match input's username");
            // might want to display this to the user
        }

        dataManager.mainUserEnjProfile = new recs.EnjoymentProfile(userID, userProfile.Name, false);
        console.log(`set ${userProfile.Name}'s enj profile as the main enj profile`);

        await registerUserSubmissions(userID, false, minTier, maxTier);
        await registerOtherUserSubmissions();

        dataManager.calculateCompats();

    } catch (err) {
        errorMsg(errorMessageText, err.message);

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
        errorMsg(errorMessageText, "Username can't be blank");
        return;
    }

    dataManager.reset();

    await getRecommendations(formData.get("username"));
});
