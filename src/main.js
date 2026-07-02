const GDDL_API_URL = "https://gdladder.com/api";
const PROXY_URL = `https://corsproxy.io/?${encodeURIComponent(GDDL_API_URL)}`;

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
    return await response.text();
}

console.log(getAPIResponse(["submissions", "pending"], {limit: 3}).then(data => console.log(data)));
