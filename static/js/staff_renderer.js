/**
 * StaffRenderer - Handles SVG rendering of musical staff and notes
 */
class StaffRenderer {
    constructor(svgId) {
        this.svg = document.getElementById(svgId);
        this.ns = "http://www.w3.org/2000/svg";
        this.width = 300;
        this.height = 150;
        this.lineSpacing = 10;
        this.topLineY = 50; // Y position of the top line (F5) on Treble Clef

        // Note to Line/Space mapping (Treble Clef)
        // Middle C (C4) is way below. 
        // Calculating offset from a reference note. 
        // Let's use B4 (center line) as reference = 0.
        // Higher notes have lower Y (negative offset * half-spacing).
        this.referenceNote = { note: 'B', octave: 4, index: 6 }; // B4 is index 6 (C=0, D=1...)

        this.initialize();
    }

    initialize() {
        // Clear SVG
        while (this.svg.firstChild) {
            this.svg.removeChild(this.svg.firstChild);
        }

        // Determine color based on theme
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        this.strokeColor = isDark ? '#ffffff' : '#000000';

        // Draw Staff Lines
        for (let i = 0; i < 5; i++) {
            const y = this.topLineY + (i * this.lineSpacing);
            this.drawLine(0, y, this.width, y, this.strokeColor, 1);
        }

        // Draw Clef 
        this.drawText("𝄞", 10, this.topLineY + 35, "40px", this.strokeColor);

        // Create Note Group (to animate)
        this.noteGroup = document.createElementNS(this.ns, "g");
        this.noteGroup.setAttribute("id", "current-note");
        this.noteGroup.style.opacity = "0"; // Hidden by default
        this.noteGroup.style.transition = "opacity 0.2s, transform 0.1s";
        this.svg.appendChild(this.noteGroup);
    }

    drawLine(x1, y1, x2, y2, color, width) {
        const line = document.createElementNS(this.ns, "line");
        line.setAttribute("x1", x1);
        line.setAttribute("y1", y1);
        line.setAttribute("x2", x2);
        line.setAttribute("y2", y2);
        line.setAttribute("stroke", color);
        line.setAttribute("stroke-width", width);
        this.svg.appendChild(line);
    }

    drawText(text, x, y, size, color) {
        const textEl = document.createElementNS(this.ns, "text");
        textEl.setAttribute("x", x);
        textEl.setAttribute("y", y);
        textEl.setAttribute("font-size", size);
        textEl.setAttribute("fill", color);
        textEl.textContent = text;
        this.svg.appendChild(textEl);
    }

    /**
     * Calculates the Y position for a given note
     * @param {string} noteStr - e.g. "C4", "F#5"
     */
    calculateY(noteStr) {
        if (!noteStr || noteStr === "—") return null;

        const p = this.parseNote(noteStr);
        if (!p) return null;

        // Note indices: C=0, D=1, E=2, F=3, G=4, A=5, B=6
        // C4 = 0 + 4*7 = 28
        // B4 = 6 + 4*7 = 34

        const noteValues = { 'C': 0, 'D': 1, 'E': 2, 'F': 3, 'G': 4, 'A': 5, 'B': 6 };
        const val = noteValues[p.note];
        const absValue = val + (p.octave * 7);

        // B4 is the middle line (index 2 from top? No)
        // Lines:
        // 0: F5
        // 1: D5
        // 2: B4 (Middle line)
        // 3: G4
        // 4: E4

        // B4 absolute value = 6 + 28 = 34
        const B4Value = 6 + (4 * 7); // 34

        // Difference in "steps" (lines/spaces)
        const diff = absValue - B4Value;

        // Each step is half line spacing
        // Positive diff means higher note -> lower Y
        const middleLineY = this.topLineY + (2 * this.lineSpacing);
        return middleLineY - (diff * (this.lineSpacing / 2));
    }

    parseNote(noteStr) {
        if (!noteStr) return null;
        // Regex to match Note + Optional Sharp + Octave
        const match = noteStr.match(/^([A-G])(#?)(\d)$/);
        if (!match) return null;
        return {
            note: match[1],
            accidental: match[2], // '#' or ''
            octave: parseInt(match[3])
        };
    }

    /**
     * Determines if note needs 8va/8vb folding
     */
    getVisualFormatting(noteStr) {
        if (!noteStr || noteStr === '—') return null;
        const p = this.parseNote(noteStr);
        if (!p) return null;

        const noteValues = { 'C': 0, 'D': 1, 'E': 2, 'F': 3, 'G': 4, 'A': 5, 'B': 6 };
        const val = noteValues[p.note];
        const absVal = val + (p.octave * 7);

        // Thresholds
        // C6 (High C) = 42. anything >= C6 shift down.
        // A3 (Low A) = 26. anything <= A3 shift up.

        const C6 = 42;
        const A3 = 26;

        let visualOctave = p.octave;
        let fold = null;

        if (absVal >= C6) {
            visualOctave = p.octave - 1;
            fold = '8va';
        } else if (absVal <= A3) {
            visualOctave = p.octave + 1;
            fold = '8vb';
        }

        // Construct new note string for Y calculation
        const visualNoteStr = `${p.note}${p.accidental}${visualOctave}`;

        return { visualNoteStr, fold, originalNote: p };
    }

    drawNote(noteStr) {
        // Clear previous note content
        while (this.noteGroup.firstChild) {
            this.noteGroup.removeChild(this.noteGroup.firstChild);
        }

        const format = this.getVisualFormatting(noteStr);
        if (!format) {
            this.noteGroup.style.opacity = "0";
            return;
        }

        const y = this.calculateY(format.visualNoteStr);
        if (y === null) return;

        // Show note
        this.noteGroup.style.opacity = "1";
        const x = this.width / 2;

        // Draw Note Head
        const head = document.createElementNS(this.ns, "circle");
        head.setAttribute("cx", x);
        head.setAttribute("cy", y);
        head.setAttribute("r", this.lineSpacing / 2 - 1);
        head.setAttribute("fill", this.strokeColor);
        this.noteGroup.appendChild(head);

        // Draw Ledger Lines if needed
        const bottomLineY = this.topLineY + (4 * this.lineSpacing);

        // Above staff
        let currY = this.topLineY - this.lineSpacing;
        while (y <= currY + 0.1) {
            this.drawLine(x - 12, currY, x + 12, currY, this.strokeColor, 1);
            currY -= this.lineSpacing;
        }
        // Below staff
        currY = bottomLineY + this.lineSpacing;
        while (y >= currY - 0.1) {
            this.drawLine(x - 12, currY, x + 12, currY, this.strokeColor, 1);
            currY += this.lineSpacing;
        }

        // Draw Accidental
        if (format.originalNote.accidental === '#') {
            this.drawText("♯", x - 24, y + 5, "20px", this.strokeColor);
        }

        // Draw 8va / 8vb bracket
        if (format.fold) {
            const is8va = format.fold === '8va';
            const bracketY = is8va ? y - 25 : y + 25;
            const textY = is8va ? bracketY - 5 : bracketY + 15;

            // Dashed Line
            const line = document.createElementNS(this.ns, "line");
            line.setAttribute("x1", x - 20);
            line.setAttribute("y1", bracketY);
            line.setAttribute("x2", x + 20);
            line.setAttribute("y2", bracketY);
            line.setAttribute("stroke", this.strokeColor);
            line.setAttribute("stroke-width", "1");
            line.setAttribute("stroke-dasharray", "4,2");
            this.noteGroup.appendChild(line);

            // Bracket End
            const endLine = document.createElementNS(this.ns, "line");
            endLine.setAttribute("x1", x + 20);
            endLine.setAttribute("y1", bracketY);
            endLine.setAttribute("x2", x + 20);
            endLine.setAttribute("y2", is8va ? bracketY + 5 : bracketY - 5);
            endLine.setAttribute("stroke", this.strokeColor);
            endLine.setAttribute("stroke-width", "1");
            this.noteGroup.appendChild(endLine);

            // Label
            const text = document.createElementNS(this.ns, "text");
            text.setAttribute("x", x - 20);
            text.setAttribute("y", textY);
            text.setAttribute("font-size", "12px");
            text.setAttribute("font-style", "italic"); // Music notation style
            text.setAttribute("fill", this.strokeColor);
            text.textContent = format.fold;
            this.noteGroup.appendChild(text);
        }
    }
}
