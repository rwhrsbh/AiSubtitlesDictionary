export function getLevenshteinDistance(a, b) {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;

    const matrix = [];

    // increment along the first column of each row
    for (let i = 0; i <= b.length; i++) {
        matrix[i] = [i];
    }

    // increment each column in the first row
    for (let j = 0; j <= a.length; j++) {
        matrix[0][j] = j;
    }

    // Fill in the rest of the matrix
    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1, // substitution
                    Math.min(
                        matrix[i][j - 1] + 1, // insertion
                        matrix[i - 1][j] + 1 // deletion
                    )
                );
            }
        }
    }

    return matrix[b.length][a.length];
}

export function isCloseMatch(input, target, alternateTarget = null) {
    const normalizedInput = input.toLowerCase().trim();

    // Parse target for multiple variants with various separators
    // Supports: comma, slash, semicolon, pipe, bullet, period+space, tilde
    // Period only counts as separator when followed by space (to preserve abbreviations like "U.S.A.")
    // Example: "is going to, is gathering" or "is going to. is gathering" or "U.S.A. government"
    const targets = [];

    // Add main target - split by common separators
    if (target) {
        // Split by: comma, slash, semicolon, pipe, bullet, tilde, or period followed by space
        const mainVariants = target
            .split(/[,/;|•~]|\.\s+/)
            .map(v => v.toLowerCase().trim())
            .filter(v => v.length > 0);
        targets.push(...mainVariants);
    }

    // Add alternate target (opposite language)
    if (alternateTarget) {
        const altVariants = alternateTarget
            .split(/[,/;|•~]|\.\s+/)
            .map(v => v.toLowerCase().trim())
            .filter(v => v.length > 0);
        targets.push(...altVariants);
    }

    // Check exact match against all variants
    for (const variant of targets) {
        if (normalizedInput === variant) {
            return { match: true, exact: true, distance: 0 };
        }
    }

    // Check close match (with typos) against all variants
    for (const variant of targets) {
        const distance = getLevenshteinDistance(normalizedInput, variant);
        // Allow 1 error for words <= 5 chars, 2 errors for longer
        const threshold = variant.length <= 5 ? 1 : 2;

        if (distance <= threshold) {
            return { match: true, exact: false, distance: distance };
        }
    }

    return {
        match: false,
        exact: false,
        distance: -1
    };
}

export function formatOptionForDisplay(text) {
    if (!text) return '';

    // Split by common separators: comma, slash, semicolon, pipe, bullet, tilde
    const variants = text
        .split(/[/;|•~]/)
        .map(v => v.trim())
        .filter(v => v.length > 0);

    if (variants.length === 0) return text;

    // If only one variant after split, return original text
    if (variants.length === 1) return text;

    // Check if this looks like a list of variants or a regular sentence
    // Heuristics:
    // 1. All variants are short (≤4 words each) - likely a list
    // 2. Most variants start with lowercase (except first) - likely a list  
    // 3. No variant is too long (>40 chars) - likely a list
    // 4. Uses slash separator - very likely a list
    const hasSlash = text.includes('/');
    const allShort = variants.every(v => v.split(/\s+/).length <= 4);
    const noLongVariants = variants.every(v => v.length <= 40);
    const mostLowercase = variants.slice(1).filter(v => v[0] && v[0] === v[0].toLowerCase()).length >= variants.length / 2;

    // If it looks like a list of variants, return one randomly
    if (hasSlash || (allShort && noLongVariants && mostLowercase)) {
        return variants[Math.floor(Math.random() * variants.length)];
    }

    // Otherwise, return original text as-is (it's likely a sentence)
    return text;
}
