/**
 * Progress Sidebar Component
 * Manages visual progress indicators for flashcards and definition cards
 */

export class ProgressSidebar {
    constructor(containerId, items, options = {}) {
        this.container = document.getElementById(containerId);
        if (!this.container) {
            console.warn(`Progress sidebar container #${containerId} not found`);
            return;
        }

        this.items = items;
        this.currentIndex = 0;
        this.states = {};
        this.hasDualSides = options.hasDualSides !== false; // Default true for flashcards/def cards
        this.onBoxClick = options.onBoxClick || (() => { });

        this.initialize();
    }

    initialize() {
        this.container.innerHTML = '';

        this.items.forEach((_, index) => {
            const box = document.createElement('div');
            box.className = 'progress-box unanswered';
            box.textContent = index + 1;
            box.dataset.index = index;

            box.addEventListener('click', () => {
                this.onBoxClick(index);
            });

            this.container.appendChild(box);
        });

        this.update();
    }

    setState(index, state) {
        this.states[index] = state;
        this.update();
    }

    setCurrentIndex(index) {
        this.currentIndex = index;
        this.update();
    }

    update() {
        const boxes = this.container.querySelectorAll('.progress-box');

        boxes.forEach((box, index) => {
            const state = this.states[index];

            // Remove all state classes
            box.classList.remove(
                'unanswered',
                'correct',
                'incorrect',
                'partial',
                'partial-left-correct',
                'partial-left-incorrect',
                'partial-right-correct',
                'partial-right-incorrect',
                'active'
            );

            if (!state) {
                box.classList.add('unanswered');
            } else if (this.hasDualSides) {
                // Dual-sided cards (flashcards, definition cards)
                const frontAnswered = state.frontAnswered || false;
                const backAnswered = state.backAnswered || false;
                const frontCorrect = state.frontCorrect || false;
                const backCorrect = state.backCorrect || false;

                if (frontAnswered && backAnswered) {
                    // Both sides answered
                    if (frontCorrect && backCorrect) {
                        box.classList.add('correct');
                    } else if (!frontCorrect && !backCorrect) {
                        box.classList.add('incorrect');
                    } else {
                        box.classList.add('partial');
                    }
                } else if (frontAnswered) {
                    // Only front answered - show left triangle
                    if (frontCorrect) {
                        box.classList.add('partial-left-correct');
                    } else {
                        box.classList.add('partial-left-incorrect');
                    }
                } else if (backAnswered) {
                    // Only back answered - show right triangle
                    if (backCorrect) {
                        box.classList.add('partial-right-correct');
                    } else {
                        box.classList.add('partial-right-incorrect');
                    }
                } else {
                    box.classList.add('unanswered');
                }
            } else {
                // Single-sided (review)
                if (state.answered === true) {
                    box.classList.add('correct');
                } else if (state.answered === false) {
                    box.classList.add('incorrect');
                } else {
                    box.classList.add('unanswered');
                }
            }

            // Highlight current
            if (index === this.currentIndex) {
                box.classList.add('active');
            }
        });
    }

    destroy() {
        if (this.container) {
            this.container.innerHTML = '';
        }
    }
}
