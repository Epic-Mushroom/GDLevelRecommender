import * as recs from "./recommendations.js";

const GDDL_API_URL = "https://gdladder.com/api";
const PROXY_URL = `https://corsproxy.io/?${encodeURIComponent(GDDL_API_URL)}`;

class APIError extends Error {
    constructor(message) {
        super(message);
        this.name = "APIError";
    }
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
        throw new APIError(`${response.status}: ${(await response.json()).message}`);
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
        throw new APIError(`${response.status}: ${(await response.json()).message}`);
    }

    return await response.json();
}

console.log(getAPIResponseText(["user", "me"], {}).then(data => console.log(data)));
