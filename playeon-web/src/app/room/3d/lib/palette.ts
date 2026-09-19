import type { RoomStyleId } from "@/lib/room-style";

/**
 * One repeating motif, drawn into a tile.
 *
 * `cell` is in pixels of a 256-wide tile and must divide it: every one of these
 * is built on a lattice, and a lattice that does not fit a whole number of
 * times into the tile shows the join on every repeat.
 */
export type Motif = {
  /**
   * - `scales` - overlapping arcs, the pattern a shoreline leaves and every
   *   tiled roof copies. Reads as a frame at small sizes.
   * - `pebbles` - a scatter of chipped stone, the way a river bed sorts itself.
   *   The only one with no lattice at all, so it hides its own repeat.
   * - `stipple` - a staggered field of dots, the shading a map uses for sand.
   * - `cells` - a honeycomb of hexagons, the way cooling basalt cracks. The
   *   only motif here made of straight edges, which is what lets it sit on a
   *   large flat surface without reading as decoration.
   * - `grain` - fine speckle with a faint brushed direction through it. Not a
   *   pattern at all but a finish, for objects that should read as *made of*
   *   something rather than as decorated.
   * - `weave` - warp and weft crossing over and under. Linen, at the scale
   *   upholstery is actually woven at.
   * - `flutes` - parallel shaded ribs. The oldest trim there is: it survives
   *   being stretched along its own length, which is what happens to anything
   *   wrapped round a long thin band.
   * - `tiles` - a grid of glazed squares with grout between them. `cell` is the
   *   tile in pixels, `ink` the grout, `accent` the glaze highlight.
   * - `ogee` - the pointed-arch lattice under every damask wallpaper ever
   *   hung. Two families of arcs crossing into tall ovals, with a mark in each.
   *   Reads as pattern from across a room and as nothing much up close, which
   *   is what old wallpaper does.
   */
  kind:
    | "scales"
    | "pebbles"
    | "stipple"
    | "cells"
    | "grain"
    | "weave"
    | "flutes"
    | "tiles"
    | "ogee";
  /** What the motif is drawn on. */
  ground: string;
  /** The motif itself. */
  ink: string;
  /** A deeper second tone, for the part of the motif that should recede. */
  accent: string;
  /** Motif size in pixels at a 256px tile; must divide 256. */
  cell: number;
  /** How many times the tile repeats across the surface it is on. */
  repeat: number;
  /**
   * Tile size in world metres, for surfaces where `repeat` is the wrong unit.
   *
   * A wall is fourteen metres by four and the ceiling is fourteen by eleven, so
   * a single repeat count across both axes stretches every hexagon into an
   * ellipse. Given metres, the scene works out a separate repeat per axis from
   * the surface's real size, and the motif stays square on whatever it is
   * printed on. Ignored where it is absent.
   */
  metres?: number;
};

/** Metres of room covered by one repeat of the floor texture. */
type FloorCommon = {
  tile: number;
  /** How sharp the highlights are: boards scatter, polished stone does not. */
  roughness: number;
};

/**
 * Sawn boards.
 *
 * `board` is an rgb triple rather than a hex string because each plank is that
 * colour scaled by its own random tone - the variation between boards is the
 * texture, and it needs arithmetic on the channels.
 */
export type PlankPaint = FloorCommon & {
  kind: "planks";
  base: string;
  board: readonly [number, number, number];
  /**
   * How far a board's tone may stray from its neighbours', either way.
   *
   * The only thing separating one board from the next once the lines are gone,
   * so it is also the thing that decides whether the floor reads as timber or
   * as stripes. A dark floor carries a lot of it; a pale one carries almost
   * none, because at high lightness the same spread is four times as visible.
   */
  variation: number;
  /** The lengthways grain drawn over each board. */
  grain: string;
  /**
   * The butt joint between two boards, and the shadow line along the edge -
   * or `null` for a floor laid without a visible seam.
   */
  joint: string | null;
  edge: string | null;
};

/**
 * A polished stone slab, cut into large tiles.
 *
 * Two vein colours, because one of them is not a marble: the wide soft one is
 * the mineral drift under the surface and the narrow dark one is the crack
 * through it, and a slab drawn with either alone reads as a smudge or as a
 * scratch.
 */
export type StonePaint = FloorCommon & {
  kind: "stone";
  base: string;
  /** The broad, diffuse drift. */
  wash: string;
  /** The fine, dark veining. */
  vein: string;
  /** The line where two tiles meet. */
  grout: string;
};

/**
 * Ceramic tile: a grid of identical squares with grout between them.
 *
 * `count` is how many tiles fit across one texture repeat, so the real tile
 * size is `tile / count` metres - which is the number that matters, because a
 * tiled surface is read by tile size and nothing else. Everything else about
 * the look is in the gloss: `roughness` on a tiled floor should be low enough
 * that the lamps land on it as pools, which in a room made of tile is most of
 * the lighting.
 */
export type TilePaint = FloorCommon & {
  kind: "tiles";
  base: string;
  grout: string;
  /** The highlight along a tile's lit edge, which is what makes it look glazed. */
  glint: string;
  count: number;
  /** How far a single tile's tone may stray from its neighbours'. */
  variation: number;
};

/**
 * Carpet: flat colour, dense fleck, and the odd stain.
 *
 * The fourth floor material because it is a fourth kind of thing - boards have
 * grain and a direction, stone has veins and slabs, tile has a grid, and carpet
 * has none of those. It has *noise*, at two sizes: the fleck of the pile, and
 * broad patches where it has been walked on or damp for years. Nothing about it
 * lines up with anything, which is the only way it reads as carpet and not as
 * paper.
 */
export type CarpetPaint = FloorCommon & {
  kind: "carpet";
  base: string;
  /** The pile: thousands of specks, two tones. */
  fleck: string;
  /** Broad soft patches, older and darker than the rest. */
  stain: string;
};

export type FloorPaint = PlankPaint | StonePaint | TilePaint | CarpetPaint;

/**
 * Every colour and surface the lounge is built out of, in one place per style.
 *
 * The scene used to hold these as literals at their point of use, which was
 * fine while there was one room. With two, the literals are the room: a style
 * is not a filter over the old colours - a pink room is not the blue one tinted,
 * because the floor, the fabric and the lamps all move differently - so each
 * style states its own, and the scene builds whatever it is handed.
 *
 * Lighting colours are here too, even though the lamps' intensities are not.
 * A lamp's colour is part of the room's look and its brightness is part of the
 * room's behaviour - the switches, the anomaly and the screen glow all reason
 * about brightness, and none of them should change because somebody repainted.
 */
export type Palette = {
  /** The fog, and the canvas behind everything. Sets the room's overall key. */
  fog: string;

  walls: {
    /** The three walls you are usually looking at. */
    side: string;
    /** The wall the screen hangs on, kept darker so the picture carries. */
    screen: string;
    ceiling: string;
    /** Skirting and the ceiling trim - the room's edges. */
    trim: string;
    /** The dropped border around the ceiling. */
    soffit: string;
  };

  /**
   * What is underfoot.
   *
   * A union rather than a set of colours, because the floor is the one surface
   * where two styles want different *materials* and not different paint. Boards
   * and stone are drawn by different code and lit at different roughness, and
   * calling a marble slab a plank with the grain turned pink would be a lie the
   * texture generator has to keep telling.
   */
  floor: FloorPaint;

  /**
   * The rug, or nothing.
   *
   * Nullable because a floor worth looking at is a reason not to cover it, and
   * that is a decision a style should get to make.
   */
  rug: {
    base: string;
    /** The woven border, laid over the speckle. */
    border: string;
  } | null;

  couch: {
    frame: string;
    cushion: string;
  };

  /** The low table in front of the couch, and the remote left on it. */
  stool: {
    top: string;
    leg: string;
    remote: string;
    /** The buttons, which have to read against the remote's own colour. */
    keys: string;
  };

  /** The screen's surround and the ring that shows while it is loading. */
  screen: {
    bezel: string;
    spinner: string;
    /** The light the picture throws into the room. */
    glow: string;
  };

  lamps: {
    /** The light itself. */
    light: string;
    /** The disc in the ceiling, lit and dark. */
    on: string;
    off: string;
    /**
     * How much the lamps wander, 0-1, and how fast.
     *
     * A candle is not a dimmer set low - it is a light that will not hold
     * still, and the difference between the two is the whole character of a
     * room lit by fire. Each lamp gets its own drift so they are never in step:
     * five lamps flickering together is a fault in the wiring, five flickering
     * apart is five flames.
     *
     * Absent for a room lit by electricity, which is most of them.
     */
    flicker?: { depth: number; rate: number };

    /**
     * What fraction of `LIGHTS.lamp` this room's lamps actually put out.
     *
     * The one piece of brightness that is a style's business rather than the
     * room's behaviour, because it is not really about the lamps - it is about
     * what the room does with what they emit. A near-white room returns most of
     * the light it is given and then returns it again off the next surface; the
     * same wattage that lit a dark room to a warm glow flattens a pale one to
     * paper. Everything that reasons about brightness - the switches, the
     * anomaly, the screen glow - scales with this, so the room dims and
     * flickers exactly as it did, just from a lower start.
     */
    power: number;
  };

  /** Bounced light: the ceiling's colour above, the floor's below. */
  fill: {
    sky: string;
    ground: string;
  };

  /**
   * What is printed, woven or set into a surface, or nothing.
   *
   * Patterns rather than colours, and they exist because a room built entirely
   * from neighbouring tones has nothing for the eye to land on - every surface
   * is one step from the next and the whole thing reads as a single flat
   * material. A motif gives it somewhere to look, which is most of what "cosy"
   * means in a room this simple.
   *
   * Three different ones rather than one repeated, because the surfaces are
   * doing different jobs: a frame around a picture, a textile underfoot, a
   * tabletop. All three motifs are borrowed from ground the sea or a river
   * made, which is where patterns that tile without looking mechanical come
   * from in the first place.
   *
   * Null for a style that would rather stay plain.
   */
  patterns: {
    bezel: Motif | null;
    rug: Motif | null;
    stool: Motif | null;
    /** The three walls that are not behind the screen. */
    walls: Motif | null;
    /** The wall the picture hangs on, which has to stay quieter than they do. */
    screenWall: Motif | null;
    ceiling: Motif | null;
    /** The band around the ceiling. */
    soffit: Motif | null;
    /** The couch's frame, back and arms - not the seat cushions. */
    couch: Motif | null;
    /** The switch plate, and the button plate that matches it. */
    plate: Motif | null;
  } | null;

  /**
   * Standing water on the floor, or nothing.
   *
   * A surface rather than a volume: one translucent plane at `depth` metres,
   * drifting slowly so it is never quite still. There is no swimming and no
   * collision - you walk through it - which is the right trade for water this
   * shallow, and the only trade available without giving the player a second
   * physics.
   */
  water: {
    colour: string;
    /** How far up the shin, in metres. */
    depth: number;
    opacity: number;
    /** Metres of floor covered by one repeat of the ripple. */
    ripple: number;
    /** Metres per second the ripple drifts. Slow: this water has no wind. */
    drift: number;
    /**
     * How steep the surface is, which decides how hard it glints.
     *
     * The single number that makes water look like water. Everything else - the
     * colour, the transparency, the drift - describes a tinted sheet of glass;
     * what says *liquid* is a moving surface breaking the lamps into highlights,
     * and this is how far the normals tilt to do it.
     */
    chop: number;
  } | null;

  /** The light switches by the door, and the button on the far wall. */
  fixtures: {
    plate: string;
    rocker: string;
    well: string;
    screw: string;
    button: string;
  };
};

const MIDNIGHT: Palette = {
  fog: "#0b0b11",
  walls: {
    side: "#22222e",
    screen: "#16161d",
    ceiling: "#131318",
    trim: "#343446",
    soffit: "#191920",
  },
  floor: {
    kind: "planks",
    tile: 2,
    roughness: 0.72,
    base: "#2a2018",
    board: [44, 33, 24],
    variation: 0.14,
    grain: "rgba(0,0,0,0.16)",
    joint: "#16100b",
    edge: "#14100c",
  },
  rug: {
    base: "#2b2839",
    border: "rgba(255,255,255,0.09)",
  },
  couch: {
    frame: "#3b3550",
    cushion: "#474066",
  },
  stool: {
    top: "#2b2438",
    leg: "#1e1a28",
    remote: "#15151b",
    keys: "#7d7d8e",
  },
  screen: {
    bezel: "#0a0a0d",
    spinner: "#ffffff",
    glow: "#ffffff",
  },
  lamps: {
    light: "#ffe0bd",
    on: "#ffd9a8",
    off: "#33333f",
    power: 1,
  },
  fill: {
    sky: "#a3a8bb",
    ground: "#241f30",
  },
  patterns: null,
  water: null,
  fixtures: {
    plate: "#3b3b4c",
    rocker: "#d8d8e4",
    well: "#141419",
    screw: "#8d8d9c",
    button: "#8e1220",
  },
};

/**
 * Sushi - a copy of Midnight, waiting to be drawn.
 *
 * Deliberately identical, not `{ ...MIDNIGHT }`: this is the surface every
 * decision about the style will be made on, and a spread would have to be
 * expanded before the first colour could be changed. Written out, the room is
 * already here and each slot can be moved one at a time with something to
 * compare against.
 *
 * Everything the type allows is still available while it is being drawn - the
 * floor can become `kind: "stone"`, the rug can become `null` - see `Palette`.
 */
const SUSHI: Palette = {
  fog: "#0b0b11",
  /*
    White, with the pink carried by saturation rather than by darkness - and
    about a third less of it than the first pass had.

    Every colour in this style was pulled the same way, by cutting its
    saturation and leaving its lightness alone, so the room got less pink
    without getting lighter, darker or rearranged. Doing it by eye, one surface
    at a time, is how a palette ends up with three different pinks that each
    looked right on their own.

    Everything vertical sits within a few points of the same near-white, and the
    tint is the small amount of red held above green and blue at high lightness
    - a wall this bright cannot be "pink" the way a dark wall can, and trying
    would give a room the colour of bubblegum instead of a room painted pink.

    The ceiling is the lightest thing in the room and the trim is the most
    saturated: the trim is the only line drawn around anything up here now that
    the walls have gone pale, so it needs the extra chroma to stay a line and
    not disappear into what it borders.

    The wall behind the screen is the one held back - still the same pink, two
    steps down. It is the surround of a bright picture, and matching it to the
    others leaves the picture nothing to be seen against. Say the word and it
    goes up with the rest.
  */
  walls: {
    side: "#f0e6e8",
    screen: "#d2c3c7",
    ceiling: "#f8f1f2",
    trim: "#deccd0",
    soffit: "#e9dfe1",
  },
  /*
    Laid seamless, and lifted into the light.

    No joint and no edge line: the boards are still there in the grain and in
    the faint tone shift between them, but nothing draws a border around each
    one. What made the dark floor read as planks was mostly those two lines, and
    without them the surface goes continuous - which is the look, and also the
    only honest way to brighten it. A pale floor with dark seams still cut
    across it just looks like a dark floor someone turned the light up on.

    `variation` comes down with the lightness for the same reason. The spread
    that read as timber at 15% lightness reads as stripes at 70%.
  */
  floor: {
    kind: "planks",
    tile: 2,
    roughness: 0.72,
    base: "#b29593",
    board: [198, 173, 171],
    variation: 0.04,
    grain: "rgba(118, 86, 90, 0.085)",
    joint: null,
    edge: null,
  },
  /*
    Everything else, in the same near-white with the pink in the saturation.

    Each thing is a step deeper than what it sits against, and that is the only
    rule at work here: a white couch on a white floor in front of a white wall
    is one white shape, so the couch is a step under the wall, the cushions a
    step over the couch, and the rug a step under the floor. Read as a column of
    lightness it goes ceiling, walls, floor, rug - which is what a room looks
    like when nothing in it is dark.
  */
  rug: {
    base: "#d8c6cc",
    border: "rgba(255,255,255,0.32)",
  },
  couch: {
    frame: "#d4c1c6",
    cushion: "#eadde0",
  },
  stool: {
    top: "#e3d8da",
    leg: "#cabec1",
    remote: "#cfc3c6",
    /* Dark enough to be buttons on a pale remote, which nothing else here is. */
    keys: "#8a7f83",
  },
  screen: {
    /*
      Pale, and the one place it costs something.

      A bezel exists to separate a picture from a wall, and a pale bezel on a
      pale wall does less of that than a dark one did. It is a step under the
      wall behind it and a step over nothing else, which is as much definition
      as this palette can give it.
    */
    bezel: "#ccbac0",
    spinner: "#ffffff",
    glow: "#ffffff",
  },
  lamps: {
    light: "#fbeaef",
    /*
      The lit disc, dialled well back.

      It is drawn unlit and untone-mapped - a flat colour, brighter than
      anything the renderer can shade - so against a dark ceiling it read as a
      bulb and against this one it read as a hole. Near the ceiling's own white
      it is a fitting again.
    */
    on: "#fdf4f7",
    off: "#d5c7cb",
    /*
      Under two thirds, because the room now does most of the work itself.

      Five lamps at full power against white walls, white ceiling and a pale
      floor is more bounced light than the scene can hold without tone mapping:
      the surfaces clip to flat white and every shape in the room loses its
      edges. This is the number to move if it still looks blown out.
    */
    power: 0.62,
  },
  fill: {
    /* The bounce, from surfaces that are now pale on both sides. */
    sky: "#f2e8eb",
    ground: "#ded0d3",
  },
  /*
    The room's one saturated note, kept to three surfaces.

    Everything else sits within a few points of white, which is restful and also
    completely inert. These carry the pink-red the rest of the palette gave up -
    and they are three different motifs on purpose, so the room looks furnished
    rather than upholstered in one fabric.
  */
  patterns: {
    /*
      A finish rather than a pattern.

      Everything tried here failed the same way, and the braid failed hardest:
      the frame is eight centimetres of surface wrapped around a rounded corner,
      so any motif with a shape to it is either too big to fit across the border
      or gets bent at the four turns. A frame does not want a pattern anyway -
      it wants to look milled. Fine speckle with a brushed direction through it
      reads as anodised metal at every distance, has no shape to misalign, and
      leaves the picture as the only thing in that rectangle with anything to
      say.
    */
    bezel: {
      kind: "grain",
      ground: "#d9c9ce",
      ink: "#bda7af",
      accent: "#ece0e3",
      cell: 32,
      repeat: 1,
      metres: 0.5,
    },
    /* River stone, the one motif with no grid - a rug shows its repeat most. */
    rug: {
      kind: "pebbles",
      ground: "#d8c6cc",
      ink: "#c08a99",
      accent: "#a86274",
      cell: 32,
      repeat: 2,
    },
    /* A quiet stipple: the table is small and sits in the middle of the room. */
    stool: {
      kind: "stipple",
      ground: "#e3d8da",
      ink: "#c9929e",
      accent: "#b0697c",
      cell: 32,
      repeat: 2,
    },
    /*
      The two surfaces that have to whisper.

      A wall and a ceiling are the largest things in view from anywhere, and a
      motif with the contrast of the rug's would turn the room into a gift box.
      These sit a few points off their own ground - enough to catch the light
      and give the surface a grain, not enough to read as a pattern until you
      look for one. Sized in metres so the cells stay square across a wall that
      is fourteen by four and a ceiling that is fourteen by eleven.
    */
    walls: {
      kind: "cells",
      ground: "#f0e6e8",
      ink: "#e4d4d8",
      accent: "#dcc8ce",
      cell: 32,
      repeat: 1,
      metres: 1.5,
    },
    /*
      The screen's own wall, quieter again.

      It gets the same cells as the others so the room is one room, but at half
      their contrast and on its own darker ground. This is the surface a bright
      picture is seen against, and the moment a pattern on it is legible it is
      competing with whatever is playing.
    */
    screenWall: {
      kind: "cells",
      ground: "#d2c3c7",
      ink: "#cbbbc0",
      accent: "#c3b1b7",
      cell: 32,
      repeat: 1,
      metres: 1.5,
    },
    /*
      Plaster, and nothing else.

      Dots were wrong for a reason worth writing down: a ceiling is the one
      surface in a room with no function, nothing hung on it and nothing near it
      for scale, so anything with a *rhythm* up there has nowhere to hide and
      the eye starts counting. A finish has no rhythm to find. This is the
      bezel's grain at twice the scale and a fraction of the contrast - enough
      that the ceiling catches light unevenly the way a painted surface does,
      not enough to be a thing you could describe.
    */
    ceiling: {
      kind: "grain",
      ground: "#f8f1f2",
      ink: "#eadde1",
      accent: "#fffdfd",
      cell: 32,
      repeat: 1,
      metres: 0.9,
    },
    /*
      Fluting, which is what a band like this has carried for about three
      thousand years.

      The band is one welded run with box UVs, so whatever goes on it is
      stretched along its length - and ribs are the one motif that does not care,
      because stretching a parallel line leaves a parallel line. The waves that
      were here got smeared into ovals by exactly that.
    */
    soffit: {
      kind: "flutes",
      ground: "#e9dfe1",
      ink: "#cdb3ba",
      accent: "#f6eef0",
      cell: 32,
      repeat: 1,
      metres: 0.3,
    },
    /*
      Linen, at the scale linen is woven at.

      The pebbles were upholstery-as-terrazzo: chips the size of a hand, which
      on a couch reads as a stain rather than a cloth. A weave has to be small
      enough that you cannot count the threads from the doorway - a centimetre
      and a half here - and then it stops being a pattern and becomes what the
      couch is made of, which is the point.

      Frame, back and arms only; the seat cushions stay plain. A patterned couch
      with plain cushions is a couch, patterned throughout it is a catalogue
      sofa, and the cushions are what your eye lands on when deciding where to
      sit.
    */
    couch: {
      kind: "weave",
      ground: "#d4c1c6",
      ink: "#c0a2ab",
      accent: "#e3d6da",
      cell: 32,
      repeat: 1,
      metres: 0.12,
    },
    /*
      The switch and button plates take the bezel's finish, at a finer grain.

      They are the same kind of object - a small hard thing screwed to a wall -
      and the two of them agreeing is worth more than either of them being
      interesting. Finer because they are a fifth the size: a finish should look
      the same from where you stand, not the same in the texture.
    */
    plate: {
      kind: "grain",
      ground: "#e5d9dc",
      ink: "#cbb8bd",
      accent: "#f4ecee",
      cell: 32,
      repeat: 1,
      metres: 0.12,
    },
  },
  water: null,
  fixtures: {
    plate: "#e5d9dc",
    rocker: "#fefcfc",
    well: "#bfacb2",
    screw: "#d2c2c7",
    /*
      The one thing kept saturated, on purpose.

      It is a button, and a white button on a white plate is a smudge. This is
      the deepest rose in the palette rather than the red it was, so it belongs
      to the room while still being the thing your eye lands on.
    */
    button: "#ca5f82",
  },
};

/**
 * Level 37. White ceramic tile in every direction, and the water.
 *
 * Built to the description rather than to a memory of it: walls, ceiling and
 * floor are the same pristine white tile - "all identical to one another,
 * without a single hint of damage on their shiny surfaces" - and the only
 * colour in the place is the blue-green of the water. Everything follows from
 * those two sentences.
 *
 * The shine is not decoration. Glazed tile is why the level reads as bright at
 * all: the surfaces throw the light back instead of absorbing it, so the floor
 * is polished to a low roughness and the lamps land on it as pools. That, plus
 * a bounce colour taken from the water rather than from the tile, is what puts
 * the aquarium light on the walls.
 *
 * What is here is the paint and the water. What is not is the architecture -
 * the pillars, the corridors, the staircases descending into deep pits - all of
 * which are geometry this room does not have and a palette cannot invent.
 */
const POOLROOMS: Palette = {
  /* Humid air, lit from every white surface at once. */
  fog: "#cfe1e0",
  walls: {
    side: "#eef4f3",
    /* The screen's wall a shade down, so the picture still has a surround. */
    screen: "#dde8e7",
    ceiling: "#f3f7f6",
    trim: "#cddbda",
    soffit: "#e6eeed",
  },
  floor: {
    kind: "tiles",
    /* Two metres of floor, twelve tiles across it - 16 cm squares. */
    tile: 2,
    count: 12,
    /* Glazed. Low enough that each lamp lands as a pool, which is the level. */
    roughness: 0.16,
    base: "#e9f0ef",
    grout: "#c2d2d1",
    glint: "#ffffff",
    variation: 0.02,
  },
  /* No rug in a room with standing water in it. */
  rug: null,
  couch: {
    frame: "#dfe8e7",
    cushion: "#eef4f3",
  },
  stool: {
    top: "#e6eeed",
    leg: "#cbd9d8",
    remote: "#dde6e5",
    keys: "#8fa3a2",
  },
  screen: {
    bezel: "#d5e0df",
    spinner: "#ffffff",
    glow: "#ffffff",
  },
  lamps: {
    /* Daylight, not tungsten: nothing in here is warm. */
    light: "#eaf8ff",
    on: "#ffffff",
    off: "#bdcecd",
    /* Every surface returns most of what it is given, so less is needed. */
    power: 0.7,
  },
  fill: {
    sky: "#eef6f5",
    /*
      The bounce off the floor is the water's colour, not the tile's.

      This one value does more for the level than any texture in it: light
      coming back up off a pool is what puts moving green on white walls, and a
      hemisphere light is exactly a floor-coloured bounce from below.
    */
    ground: "#8fd3cc",
  },
  patterns: {
    /* The same tile everywhere, at the same size everywhere. That is the level. */
    walls: {
      kind: "tiles",
      ground: "#eef4f3",
      ink: "#c9d8d7",
      accent: "#ffffff",
      cell: 32,
      repeat: 1,
      metres: 0.64,
    },
    screenWall: {
      kind: "tiles",
      ground: "#dde8e7",
      ink: "#bfd0cf",
      accent: "#f4fbfa",
      cell: 32,
      repeat: 1,
      metres: 0.64,
    },
    ceiling: {
      kind: "tiles",
      ground: "#f3f7f6",
      ink: "#d2dedd",
      accent: "#ffffff",
      cell: 32,
      repeat: 1,
      metres: 0.64,
    },
    soffit: {
      kind: "tiles",
      ground: "#e6eeed",
      ink: "#c6d5d4",
      accent: "#ffffff",
      cell: 32,
      repeat: 1,
      metres: 0.32,
    },
    /* Smaller tiles on the small things, the way a real pool hall does it. */
    stool: {
      kind: "tiles",
      ground: "#e6eeed",
      ink: "#c4d3d2",
      accent: "#ffffff",
      cell: 32,
      repeat: 1,
      metres: 0.24,
    },
    bezel: null,
    rug: null,
    couch: null,
    plate: null,
  },
  water: {
    /* The one colour in the level. */
    colour: "#31a89e",
    /* Mid-shin. Deep enough to read as a pool rather than a wet floor. */
    depth: 0.17,
    opacity: 0.6,
    ripple: 2.2,
    drift: 0.03,
    chop: 0.55,
  },
  fixtures: {
    plate: "#e2ecea",
    rocker: "#ffffff",
    well: "#a8bcbb",
    screw: "#c6d4d3",
    /* Pool-tile teal, the only saturated thing above the waterline. */
    button: "#149c92",
  },
};

/**
 * A shuttered parlour, some time after everyone left.
 *
 * Built on one decision: this is a *warm* room in a *cold* one. The lamps are
 * candle-coloured and the bounce off the floor is warm with them, but the fill
 * from above is a flat blue-grey - moonlight through shutters - so everything
 * the candles do not reach goes cold and slightly blue. That split is what
 * makes a dark room read as night rather than as an unlit room, and it is worth
 * more than any amount of orange.
 *
 * Everything else follows the same rule as the other styles: the surfaces are
 * dark, so the patterns on them have to be nearly the same colour as the ground
 * or they turn into decoration. Old wallpaper is barely visible in candlelight
 * anyway, which is convenient.
 */
const HALLOWEEN: Palette = {
  /* Near-black, faintly violet: the colour of a room with the lights off. */
  fog: "#0c0810",
  walls: {
    side: "#2a1f33",
    screen: "#170f1d",
    ceiling: "#150e1b",
    /* Tarnished brass picture rail, the one warm line above eye level. */
    trim: "#6a4a2a",
    soffit: "#1d1526",
  },
  floor: {
    kind: "planks",
    tile: 2,
    /* Waxed boards: enough sheen that the candles pool on them. */
    roughness: 0.55,
    base: "#241710",
    board: [58, 38, 26],
    variation: 0.16,
    grain: "rgba(0,0,0,0.22)",
    joint: "#140c07",
    edge: "#100a06",
  },
  rug: {
    /* Old blood-red, worn dark. */
    base: "#3a1420",
    border: "rgba(214,160,90,0.16)",
  },
  couch: {
    frame: "#2c1a33",
    cushion: "#3a2342",
  },
  stool: {
    top: "#2a1c14",
    leg: "#1a110c",
    remote: "#141019",
    keys: "#7d6a52",
  },
  screen: {
    bezel: "#0a0710",
    spinner: "#ffd9a0",
    glow: "#ffffff",
  },
  lamps: {
    /* Flame, not tungsten: further into the orange than any bulb goes. */
    light: "#ff9d42",
    on: "#ffbe72",
    off: "#2a2130",
    power: 0.82,
    /* Slow and shallow. A candle gutters; it does not strobe. */
    flicker: { depth: 0.16, rate: 1.9 },
  },
  fill: {
    /* Moonlight from above, candle-warmth bouncing back off the boards. */
    sky: "#5a5570",
    ground: "#2a1a14",
  },
  patterns: {
    /* Damask, at the contrast damask has by candlelight. */
    walls: {
      kind: "ogee",
      ground: "#2a1f33",
      ink: "#3a2c47",
      accent: "#4a3559",
      cell: 64,
      repeat: 1,
      metres: 0.85,
    },
    screenWall: null,
    /* Aged plaster overhead - nothing to look at, which is the point. */
    ceiling: {
      kind: "grain",
      ground: "#150e1b",
      ink: "#0e0913",
      accent: "#241a2c",
      cell: 32,
      repeat: 1,
      metres: 0.9,
    },
    /* A carved cornice, picked out by the candles below it. */
    soffit: {
      kind: "flutes",
      ground: "#1d1526",
      ink: "#100a16",
      accent: "#4a3358",
      cell: 32,
      repeat: 1,
      metres: 0.26,
    },
    bezel: null,
    rug: null,
    couch: null,
    stool: null,
    plate: null,
  },
  water: null,
  fixtures: {
    plate: "#3a2f2a",
    /* Bone. */
    rocker: "#d9caa8",
    well: "#0f0b12",
    screw: "#8a7757",
    /* Pumpkin, and the only thing in the room at full saturation. */
    button: "#ff6a1f",
  },
};

const PALETTES: Record<RoomStyleId, Palette> = {
  default: MIDNIGHT,
  sushi: SUSHI,
  poolrooms: POOLROOMS,
  halloween: HALLOWEEN,
};

export function paletteFor(style: RoomStyleId): Palette {
  return PALETTES[style] ?? MIDNIGHT;
}
