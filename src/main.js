import * as recs from "./recommendations.js";
import {dataManager, getRandomInt} from "./recommendations.js"

const GDDL_API_URL = "https://gdladder.com/api";
const PROXY_URL = `https://corsproxy.io/?${encodeURIComponent(GDDL_API_URL)}`;

const NUM_SUBMISSIONS_PER_PAGE = 25;

const DEFAULT_MIN_TIER = 1;
const DEFAULT_MAX_TIER = 39;

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
async function getAPIResponseText(pathVariables, queryParams) {
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
        throw new APIError(response.status, `${response.status}: ${(await response.json()).message}`);
    }

    return await response.text();
}

/**
 * 
 * @param {Array<string>} pathVariables 
 * @param {Object} queryParams 
 */
async function getAPIResponse(pathVariables, queryParams) {
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

        if (contentType && contentType.includes("application/json")) {
            throw new APIError(`${response.status}: ${(await response.json()).message}`);

        } else {
            throw new APIError(`${response.status}: ${await response.text()}`);

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

/**
 * 
 * @param {string} username 
 */
async function registerUserSubmissions(userID, isOther = false, minTier = DEFAULT_MIN_TIER, maxTier = DEFAULT_MAX_TIER) {
    const userProfile = await getUserProfile(userID);    
    const numSubmissions = userProfile.SubmissionCount;
    const username = userProfile.Name;
    const numPages = Math.ceil(numSubmissions * 1.0 / NUM_SUBMISSIONS_PER_PAGE);
    console.log(`attempting to register ${numSubmissions} submissions for ${username}`);

    let numSubmissionsRegistered = 0;

    for (let pageNum = 0; pageNum < numPages; pageNum++) {
        const response = await getAPIResponse(["user", userID, "submissions"], {
            minTier: minTier,
            maxTier: maxTier,
            limit: NUM_SUBMISSIONS_PER_PAGE,
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
