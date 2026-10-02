// Tiny Toad character controller — bitmap poses (idle/happy/shocked/jump)
// + procedural states (blink/excited/win) via CSS classes.
import { toadPath } from './assets.js';

const POSE_FOR_STATE = { idle: 'idle', blink: 'idle', happy: 'happy', excited: 'happy', win: 'jump', jump: 'jump', shocked: 'shocked' };

export class Toad {
  constructor(el, color) {
    this.el = el; this.img = el.querySelector('img'); this.color = color;
    this.state = null; this.timer = null; this.blinkTimer = null;
    this.setState('idle');
    this.scheduleBlink();
    this.img.addEventListener('animationend', () => { if (this.state !== 'idle' && this.state !== 'win') this.setState('idle'); });
  }

  setColor(color) { this.color = color; this.setState(this.state, true); }

  setState(state, force = false) {
    if (!force && state === this.state && state !== 'blink') return;
    this.state = state;
    this.img.src = toadPath(this.color, POSE_FOR_STATE[state] || 'idle');
    this.img.className = '';
    void this.img.offsetWidth; // restart animation
    this.img.classList.add('anim-' + state);
    if (state === 'win') {
      // alternate jump/happy frames while celebrating
      clearInterval(this.timer);
      let flip = false;
      this.timer = setInterval(() => { flip = !flip; this.img.src = toadPath(this.color, flip ? 'happy' : 'jump'); }, 550);
    } else { clearInterval(this.timer); }
  }

  scheduleBlink() {
    clearTimeout(this.blinkTimer);
    this.blinkTimer = setTimeout(() => {
      if (this.state === 'idle') { this.setState('blink'); setTimeout(() => { if (this.state === 'blink') this.setState('idle'); }, 180); }
      this.scheduleBlink();
    }, 2500 + Math.random() * 3500);
  }

  react(event) {
    switch (event) {
      case 'spin': this.setState('excited'); break;
      case 'small': this.setState('happy'); break;
      case 'medium': this.setState('jump'); break;
      case 'big': case 'mega': this.setState('win'); break;
      case 'nearmiss': this.setState('shocked'); break;
      case 'lose': this.setState('idle'); break;
      case 'stop': this.setState('idle'); break;
    }
  }
}
