const MAX_BATCH_REQUEST_SIZE = 13;

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

/**
 * 
 * @param {Array} arr 
 * @param {number} chunkSize 
 * @returns 
 */
export function chunkArray(arr, chunkSize) {
    const chunks = [];

    for (let i = 0; i < arr.length; i += chunkSize) {
        chunks.push(arr.slice(i, i + chunkSize));
    }

    return chunks;
}

/**
 * measures the time elapsed of an awaited async function call
 * @param {async} operation async function
 * @param {Array} paramsArr array of parameters
 * @param {string} name 
 */
export async function measureTime(operation, paramsArr, name = null) {
    const timestamp = Date.now();
    const operationResult = await operation(...paramsArr);
    const timeElapsed = Date.now() - timestamp;

    console.log(`time elapsed for ${(name == null) ? "operation" : name}: ${timeElapsed}ms`);
    return operationResult;
}

/**
 * both arrays must have the same size
 * @param {Array<number>} ratings1 
 * @param {Array<number>} ratings2 
 * @returns 
 */
export function pearson(ratings1, ratings2) {
    const n = ratings1.length;
    if (n < 2 || n !== ratings2.length) {
        return 0; 
    }

    const avg1 = ratings1.reduce((sum, val) => sum + val, 0) / n;
    const avg2 = ratings2.reduce((sum, val) => sum + val, 0) / n;

    let numerator = 0;
    let sumOfSquares1 = 0;
    let sumOfSquares2 = 0;

    for (let i = 0; i < n; i++) {
        const difference1 = ratings1[i] - avg1;
        const difference2 = ratings2[i] - avg2;

        numerator += difference1 * difference2;
        sumOfSquares1 += difference1 * difference1;
        sumOfSquares2 += difference2 * difference2;
    }

    // need to check if any of the sums are 0, or else we would divide by 0
    if (sumOfSquares1 === 0 || sumOfSquares2 === 0) {
        return 0;
    } 

    return numerator * 1.0 / Math.sqrt(sumOfSquares1 * sumOfSquares2);
}

/**
 * 
 * @param {[string, number][]} arr2D 
 */
export function normalize2DArr(arr2D, magnitude) {
    const sumOfSquaredWeights = arr2D.reduce((sum, keyValPair) => sum + keyValPair[1] ** 2, 0);
    const oldMagnitude = Math.sqrt(sumOfSquaredWeights);
    const ratio = magnitude / oldMagnitude;

    return arr2D.map(([key, val]) => [key, val * ratio]);
}

/**
 * adjusts a value that is within oldRange so that it fits the same way in newRange
 * for example, adjusting the value 5 from oldRange [0, 10] to newRange [1, 2] will return 1.5
 * @param {number} value 
 * @param {Array<number>} oldRange 
 * @param {Array<number>} newRange 
 */
export function adjustToRange(value, oldRange, newRange) {
    if (oldRange.length !== 2 || newRange.length !== 2) {
        throw new Error("ranges must have length 2");
    }

    const oldRangeLength = oldRange[1] - oldRange[0];
    const newRangeLength = newRange[1] - newRange[0];

    const rangeProportion = (value - oldRange[0]) * 1.0 / oldRangeLength;
    return newRange[0] + rangeProportion * newRangeLength;
}