export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 
 * @param {string} string 
 * @param {number} defaultValue
 * @param {number} min 
 * @param {number} max 
 * @returns 
 */
export function purifyInt(string, defaultValue = 0, min = -Infinity, max = Infinity) {
    let float = parseFloat(string);
    float = Math.max(Math.min(float, max), min);
    return (isNaN(float) ? defaultValue : Math.round(float));
}

export function getRandomInt(min, max) {
    min = Math.ceil(min);
    max = Math.floor(max) + 1;
    return Math.floor(Math.random() * (max - min) + min);
}

/**
 * @template T
 * @param {Iterable<T>} iterable 
 * @param {number} n
 * @param {function(T): number} func a function that is called on each element to use the result as the basis for sorting
 * @returns {T[]}
 */
export function getNSmallest(iterable, n, func = (a) => a) {
    const resultArr = [];
    let largestElem = null;
    let largestBasis = null;
    
    for (const element of iterable) {
        const basis = func(element);

        if (resultArr.length < n || (largestElem != null && basis < largestBasis)) {
            resultArr.push(element);

            if (largestElem == null) {
                largestElem = element; 
                largestBasis = func(element);
                continue;
            }

            // kick out overflowing element
            if (resultArr.length > n) {
                for (let i = 0; i < resultArr.length; i++) {
                    if (func(resultArr[i]) >= largestBasis) {
                        resultArr.splice(i, 1);
                        break;
                    }
                }
            }

            // recalculate largestBasisInSet and largestElemInSet
            largestBasis = null;
            largestElem = null;
            for (const setElem of resultArr) {
                const thisBasis = func(setElem);
                if (largestBasis == null || thisBasis > largestBasis) {
                    largestBasis = thisBasis;
                    largestElem = setElem;
                }
            }
        }
    }

    resultArr.sort((a, b) => func(a) - func(b));

    return resultArr;
}

export function reverseMap(map) {
    return new Map(Array.from(map, ([key, val]) => [val, key]));
}