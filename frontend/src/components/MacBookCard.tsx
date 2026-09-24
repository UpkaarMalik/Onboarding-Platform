import { Link } from 'react-router-dom';
import { BrandMark, BrandWord } from './BrandLogo';

/**
 * A laptop lying folded shut that swings open when you hover, showing a
 * lit AndBoard screen and a "New to Mac" chip. Leads to Mac Tools.
 *
 * Built to the attached mockup. The lid is a front-on panel hinged on
 * its BOTTOM edge and folded away from you at -64deg, so shut is the lid
 * pointing away into the page and open is it standing upright at 0. That
 * is the opposite hinge from the tilted-desk version this replaces, and
 * it is why there is no 3D deck here — the base is a plain 15px bar the
 * lid stands on.
 *
 * The three reveals are staggered on purpose, and the order is the
 * mockup's: the lid swings (620ms), the screen lights 200ms in, the logo
 * rises at 300ms, and the chip arrives last at 420ms — landing in front
 * of the machine and over the logo, which is where it is meant to be.
 */
export default function MacBookCard() {
  return (
    <Link to="/mac-tools" className="mb" aria-label="New to Mac? Open Mac Tools">
      <span className="mb__lid">
        <span className="mb__disp">
          <span className="mb__screenlight" aria-hidden="true" />
          <span className="mb__screentext">
            <BrandMark className="mb__mark" />
            <BrandWord className="mb__word" brandClassName="mb__word--brand" />
          </span>
        </span>
      </span>
      <span className="mb__base">
        <span className="mb__notch" />
      </span>
      {/* Outside the lid on purpose. Inside it the screen's overflow
          clipped the chip to the glass, so it could only ever slide
          around behind the bezel; out here it is a flat card in front of
          the whole machine and can overhang it. */}
      <span className="mb__pop">New to Mac?</span>
    </Link>
  );
}
