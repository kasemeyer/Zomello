import { resetDemo } from "../demo";

/** The online demo: says where changes go, with a way to start over and a link to the real app. */
export function DemoBanner() {
  return (
    <div className="secure-banner demo-banner">
      <span className="grow">
        <b>Live demo.</b> Try anything. Changes are only saved in this browser.
      </span>
      <button className="btn sm" onClick={resetDemo}>
        Reset demo
      </button>
      <a className="btn sm primary" href="https://github.com/kasemeyer/Zomello/releases/latest" target="_blank" rel="noreferrer">
        Get TCI Boards
      </a>
    </div>
  );
}
