import * as recs from "./recommendations.js";
import {getRandomInt} from "./recommendations.js"

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
async function getUserSubmissions(userID, minTier = DEFAULT_MIN_TIER, maxTier = DEFAULT_MAX_TIER) {
    const numSubmissions = (await getUserProfile(userID)).SubmissionCount;
    const numPages = Math.ceil(numSubmissions * 1.0 / NUM_SUBMISSIONS_PER_PAGE);

    const enjMap = new Map();

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

            enjMap.set(submission.Level.ID, submission.Enjoyment);
        }
    }

    return enjMap;
}

async function retrieveUserData(username) {
    try {
        const userID = await getUserID(username);

        if (userID == null) {
            console.warn("user not found");
            return;
        }

        const userProfile = await getUserProfile(userID);
        const userSubmissions = await getUserSubmissions(userID);

        if (userProfile.Name != username) {
            console.warn("found user's name does not match input's username");
        }

        console.log(`retrieved data of ${userProfile.Name}`);

        const userSubmissionsArr = Array.from(userSubmissions);
        console.log(userSubmissionsArr);
        const randomLevelID = userSubmissionsArr[getRandomInt(0, userSubmissionsArr.length - 1)][0];
        console.log(`enjoyment submitted for level ID: ${randomLevelID} is ${userSubmissions.get(randomLevelID)}`);

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

    await retrieveUserData(formData.get("username"));
});
