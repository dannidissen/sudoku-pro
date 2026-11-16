/* Reparent existing controls: listeners, game state and accessible IDs stay intact. */
class SudokuFocusUI {
    constructor(app) {
        this.app = app;
        this.toggle = document.getElementById('btn-focus');
        this.tools = document.getElementById('btn-focus-tools');
        this.drawer = document.getElementById('modal-tools');
        this.dock = document.getElementById('focus-dock');
        this.media = window.matchMedia('(max-width: 900px), (pointer: coarse) and (max-height: 600px)');
        this.preference = null;
        try {
            const saved = localStorage.getItem('sudoku_pro_focus_v1');
            if (saved === 'true' || saved === 'false') this.preference = saved === 'true';
        } catch (_) { /* Storage is optional, including in private browsing. */ }
        this.moves = [
            ['.header-actions', '#focus-secondary'],
            ['.color-palette-group', '#focus-secondary'],
            ['.control-column', '#focus-secondary'],
            ['.timer-card', '#focus-timer'],
            ['.mode-selector-group', '#focus-dock'],
            ['#numpad', '#focus-dock'],
            ['#btn-erase', '#focus-edit-tools'],
            ['#btn-undo', '#focus-edit-tools'],
            ['#btn-redo', '#focus-edit-tools']
        ].map(([source, destination]) => {
            const node = document.querySelector(source);
            const anchor = document.createComment(`Original position: ${source}`);
            node.before(anchor);
            return { node, anchor, destination: document.querySelector(destination) };
        });
        this.toggle.addEventListener('click', () => {
            this.preference = !this.enabled;
            try { localStorage.setItem('sudoku_pro_focus_v1', String(this.preference)); } catch (_) { /* Optional. */ }
            this.sync();
        });
        this.tools.addEventListener('click', () => app.openModal('modal-tools'));
        // Close before the existing action runs, so child dialogs return to a visible opener.
        this.drawer.addEventListener('click', event => {
            const button = event.target.closest('button');
            if (!button || button.closest('.modal-header') || button.closest('.pencil-size-control') || button.id === 'btn-theme') return;
            app.closeModal('modal-tools');
        }, true);
        this.media.addEventListener('change', () => this.sync());
        this.watchBanners();
        this.sync();
    }

    /**
     * The hint and auto-complete banners sit above the board in focus mode. Publish
     * their live height (plus the grid gap) as --focus-banner-h so the board shrinks
     * by that much instead of pushing the keypad below the bottom of a short phone.
     */
    watchBanners() {
        const column = document.querySelector('.board-column');
        const banners = ['hint-banner', 'cascade-banner']
            .map(id => document.getElementById(id))
            .filter(Boolean);
        if (!column?.style || banners.length === 0) return;
        const gap = 8;
        const publish = () => {
            const total = banners.reduce((sum, banner) => sum + (banner.offsetHeight ? banner.offsetHeight + gap : 0), 0);
            column.style.setProperty('--focus-banner-h', `${total}px`);
        };
        if (typeof ResizeObserver === 'function') {
            const observer = new ResizeObserver(publish);
            banners.forEach(banner => observer.observe(banner));
        }
        publish();
    }

    sync() {
        const enabled = this.preference ?? this.media.matches;
        if (enabled === this.enabled) return;
        const drawerWasOpen = this.drawer.classList.contains('open');
        if (drawerWasOpen) this.app.closeModal('modal-tools');
        this.enabled = enabled;
        // Restore inner controls first, then their parent panels.
        const moves = enabled ? this.moves : [...this.moves].reverse();
        for (const { node, anchor, destination } of moves) {
            if (enabled && destination === this.dock) destination.insertBefore(node, document.getElementById('focus-edit-tools'));
            else if (enabled) destination.append(node);
            else anchor.after(node);
        }
        document.body.classList.toggle('focus-mode', enabled);
        this.toggle.setAttribute('aria-pressed', String(enabled));
        this.tools.hidden = !enabled;
        this.dock.hidden = !enabled;
        if (!enabled) {
            this.app.modalReturnFocus?.forEach((target, id) => {
                if (target === this.tools) this.app.modalReturnFocus.set(id, this.toggle);
            });
            if (drawerWasOpen) this.toggle.focus({ preventScroll: true });
        }
    }
}

if (typeof module !== 'undefined') module.exports = SudokuFocusUI;
