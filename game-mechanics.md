# Game Mechanics

## Core concept

Nine players enter a labyrinth in three squads. Each squad begins in a different location and must reach the central hub. Most players are survivors trying to unlock the labyrinth and escape, while two hidden wardens try to delay and misdirect them until time runs out.

Traps and other hazards can delay or temporarily imprison players, but they do not eliminate players.

## Players, squads, and roles

- There are **9 players** divided into **3 squads of 3 players**.
- There are **7 survivors** and **2 wardens**.
- The two wardens always start in different squads; a squad can contain no more than one warden.
- As a result, two squads contain two survivors and one warden, while one squad contains three survivors.
- Players do not know which squad consists entirely of survivors.
- The wardens know one another's identities from the beginning.
- The wardens cannot communicate remotely and cannot see one another's locations on their maps.

## Communication

- Communication is proximity-based: players can communicate only with other nearby players.
- Squads can compare their observations after meeting at the central hub.
- Escaped survivors can no longer move through the labyrinth, act, or communicate with players who are still inside.

## Labyrinth and central hub

- The three squads spawn in different locations in the labyrinth.
- The central hub has **4 entrances**.
- The squads approach the hub through three different entrances, leaving one entrance initially unexplored.
- The routes and entrances should be visually distinguishable enough for players to describe and discuss them.
- Compatible north- and south-closed 6x6 T-junctions are decorated at an 85% density, with at least one selected whenever any valid candidate exists. Each expanded stone-ruin, flower, bush, rock, and signpost composition spans the center, west, east, and open vertical cell; all four must be free of solid authored placements, while floor-only trap cells may share the footprint. Props use orientation-specific matching client/server collision.
- Open north-south boundaries sometimes receive the authored 6x12 decorated vertical-passage composition. Its two adjacent 6x6 cells must both be free of every generated cell occupant, including traps and decorated T-junction footprints. The passage has no objective or interaction; its four foliage rectangles use matching client/server collision.

## Wardstones

- There are **3 wardstones** at the central hub, corresponding to the three squads.
- At least one member of each squad must activate its respective wardstone.
- All three wardstones must be activated before the escape doors unlock.
- Once every wardstone is active, players can travel back into the labyrinth to locate an escape door.

## Escape doors

- Escape doors are placed within the labyrinth at the beginning of the match, but start locked.
- Players can discover and remember the locations of locked escape doors while travelling toward the central hub.
- Activating all three wardstones unlocks the escape doors.
- A discovered escape door can be used by the survivors once it is unlocked.
- Wardens cannot pass through escape doors and are not supposed to escape.

### Finding an escape door

- At the hub, squads can tell one another whether they saw a locked escape door on their inward journey.
- These reports are not automatically verified, allowing wardens to lie about seeing or not seeing a door.
- If no squad reports seeing a door, players can reason that searching through the unused fourth hub entrance may be their best option.
- The unused entrance is a strong clue, not necessarily a guarantee, so searching and player judgment still matter.

## Time limit and victory conditions

- The match has a time limit for unlocking the labyrinth and escaping.
- **Survivors win immediately when 5 of the 7 survivors have escaped.** The match ends as soon as the fifth survivor escapes.
- **Wardens win when the timer expires and 4 or fewer survivors have escaped.**
- Wardens do not count toward the escape total because they cannot escape.
- This threshold allows up to two survivors to remain trapped without causing the entire survivor side to lose.

## Wisdom orbs

- Every survivor receives **1 wisdom orb**.
- Wardens do not receive wisdom orbs because their map already gives them superior navigation information.
- A wisdom orb is consumed after one use.
- Away from a nearby obstacle interaction, using one privately shows its owner an arrow pointing in the general direction of the maze's center.
- At either entrance of a sword field, survivors always see a `[ Q ]` prompt. Using it with an orb lowers every sword and opens the route after a short shared magic animation; using it without one explains that a Wisdom Orb must be found first.
- Wardens see a red `[ E ]` at the same entrances. Pressing it clears the sword field without spending an orb, and wardens may repeat this at every field they encounter.
- The arrow does not provide a full route or turn-by-turn directions.
- Direction and hidden-route reveals are private. World-changing uses such as clearing a sword field are visible to everyone because the obstacle state is shared.
- Because use is private, a warden can falsely claim to have consumed an orb and use that claim to justify a suggested direction.

## Warden information and play

### Trap cells and cages

- Every room deterministically places 6-10 trap cells on otherwise empty 6x6 maze cells. They avoid all spawns, the hub, gates, solid authored obstacles, treasure cells, and the portal platform, but may share cells with visual T-junction decorations.
- Wardens see trap cells as translucent red floor regions in the world and as red cells on both versions of their minimap. Survivors do not see either indicator.
- A warden inside or within 20 pixels of a trap cell sees a red `[ E ]` above their head. Keyboard/mobile `E`, or clicking the prompt, asks the server to activate that nearby cell.
- One activation checks every trap cell simultaneously. Each uncaged survivor currently standing in any trap cell receives a cage at their exact position.
- A closed cage completely immobilizes its survivor without freezing their character animation: movement input changes facing and plays the walk cycle in place. The visual uses `birdCage1` behind the character and `birdCage2` in front, with a short magical materialization effect.
- A different, non-imprisoned player within 28 pixels sees `[ E ]` and can open the gate, swapping the front art to `birdCage3`. The prisoner may then move only up or down until they clear the cage.
- Once vacated, the empty cage remains a permanent solid collider and cannot be entered again.
- If the same survivor is trapped again in the same trap cell, their previous cage in that cell disappears as the new cage materializes. Cages belonging to other players or other cells remain in place.

Each warden has a private map that shows:

- The complete labyrinth layout.
- Trap cells, marked in **red**.
- Escape-door locations from the beginning of the match.

The warden map does **not** show:

- Current player positions.
- The other warden's position.

Wardens use this information to mislead survivors, waste their time, and guide them toward traps. Possible deceptions include:

- Claiming that a wisdom orb indicated a particular direction.
- Leading a squad along a longer or trap-filled route.
- Claiming to have seen a locked escape door in the wrong part of the labyrinth.
- Denying that a real escape door was seen.
- Giving correct information early to earn trust before misleading players later.

Warden interference should focus on delay, misinformation, and manipulation rather than eliminating players or permanently blocking required objectives.

## Intended match flow

1. Three squads spawn in different areas of the labyrinth.
2. Every squad's direct generated route toward the central hub contains exactly one sword field. Additional fields may appear elsewhere, but never add a second field to a direct route. Survivors can spend limited wisdom orbs to clear them, while wardens can clear them freely with `E`.
3. Each squad activates its wardstone.
4. At the hub, players exchange information about routes, hazards, and possible escape-door locations.
5. Once all three wardstones are active, the escape doors unlock.
6. Players search the labyrinth and try to escape before time expires, while wardens mislead and delay them.
7. The match ends immediately when five survivors escape, or when the timer expires.

## Playtesting variables

The following values and details should be tuned through playtesting:

- Total match duration.
- Maze size and navigation difficulty.
- Trap-cell frequency, activation cadence, and cage rescue distance.
- How visible locked escape doors are from commonly travelled routes.
- How often the unused fourth hub route is the best place to search.
- How much directional precision a wisdom-orb arrow provides.
- Whether showing escape-door locations to wardens from the start gives them too much influence.
