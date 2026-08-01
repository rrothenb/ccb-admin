import {
  splitBarcodes,
  parseBoxMap,
  boxBarcodeFor,
  unboxedBarcodes,
  isFullyBoxed,
  boxLabel,
  containingBoxOf,
  soleContainingBoxOf,
} from './box';

/** A box holding two discs, plus a title with one boxed and one loose copy. */
const BOX = { title: 'The Sopranos — Complete', barcodes: 'BOX1', resourceBox: '' };
const DISC = { title: 'The Sopranos S1', barcodes: 'D1|D2', resourceBox: '{"D1":"BOX1","D2":"BOX1"}' };
const PARTIAL = { title: 'Hamlet', barcodes: 'H1|H2', resourceBox: '{"H1":"BOX1"}' };
const LOOSE = { title: 'Middlemarch', barcodes: 'M1', resourceBox: '' };
const ALL = [BOX, DISC, PARTIAL, LOOSE];

describe('splitBarcodes', () => {
  it('splits, trims and drops blanks', () => {
    expect(splitBarcodes(' a | b ||c ')).toEqual(['a', 'b', 'c']);
  });

  it('handles blank and numeric sheet values', () => {
    expect(splitBarcodes('')).toEqual([]);
    expect(splitBarcodes(null)).toEqual([]);
    expect(splitBarcodes(undefined)).toEqual([]);
    expect(splitBarcodes(12345)).toEqual(['12345']);
  });
});

describe('parseBoxMap', () => {
  it('parses a child → box mapping', () => {
    expect(parseBoxMap('{"D1":"BOX1"}')).toEqual({ D1: 'BOX1' });
  });

  it('treats unusable cells as not boxed rather than throwing', () => {
    expect(parseBoxMap('')).toEqual({});
    expect(parseBoxMap('not json')).toEqual({});
    expect(parseBoxMap('[1,2]')).toEqual({});
    expect(parseBoxMap('null')).toEqual({});
    expect(parseBoxMap('"BOX1"')).toEqual({});
  });

  it('ignores entries with a blank or non-string box barcode', () => {
    expect(parseBoxMap('{"D1":"","D2":"  ","D3":null,"D4":7,"D5":"BOX1"}')).toEqual({ D5: 'BOX1' });
  });

  it('trims the box barcode', () => {
    expect(parseBoxMap('{"D1":" BOX1 "}')).toEqual({ D1: 'BOX1' });
  });
});

describe('boxBarcodeFor', () => {
  it('finds the box a copy sits in', () => {
    expect(boxBarcodeFor(DISC, 'D1')).toBe('BOX1');
  });

  it('returns null for a standalone copy', () => {
    expect(boxBarcodeFor(PARTIAL, 'H2')).toBeNull();
    expect(boxBarcodeFor(LOOSE, 'M1')).toBeNull();
  });
});

describe('unboxedBarcodes', () => {
  it('keeps only the individually borrowable copies', () => {
    expect(unboxedBarcodes(DISC)).toEqual([]);
    expect(unboxedBarcodes(PARTIAL)).toEqual(['H2']);
    expect(unboxedBarcodes(LOOSE)).toEqual(['M1']);
  });

  it('ignores mappings for barcodes the resource does not own', () => {
    expect(unboxedBarcodes({ barcodes: 'M1', resourceBox: '{"OTHER":"BOX1"}' })).toEqual(['M1']);
  });
});

describe('isFullyBoxed', () => {
  it('is true only when every copy is inside a box', () => {
    expect(isFullyBoxed(DISC)).toBe(true);
    expect(isFullyBoxed(PARTIAL)).toBe(false);
    expect(isFullyBoxed(LOOSE)).toBe(false);
    expect(isFullyBoxed(BOX)).toBe(false);
  });

  it('is false for a resource with no barcodes at all', () => {
    expect(isFullyBoxed({ barcodes: '', resourceBox: '{"D1":"BOX1"}' })).toBe(false);
  });
});

describe('boxLabel', () => {
  it('names the box by its owning resource title', () => {
    expect(boxLabel('BOX1', ALL)).toBe('The Sopranos — Complete');
  });

  it('falls back to the barcode when no resource owns it', () => {
    expect(boxLabel('GHOST', ALL)).toBe('GHOST');
  });
});

describe('containingBoxOf', () => {
  it('describes the box for a boxed copy', () => {
    expect(containingBoxOf(DISC, 'D1', ALL)).toEqual({
      boxBarcode: 'BOX1',
      boxTitle: 'The Sopranos — Complete',
    });
  });

  it('returns null for a standalone copy', () => {
    expect(containingBoxOf(PARTIAL, 'H2', ALL)).toBeNull();
  });
});

describe('soleContainingBoxOf', () => {
  it('describes the box when no copy is borrowable alone', () => {
    expect(soleContainingBoxOf(DISC, ALL)).toEqual({
      boxBarcode: 'BOX1',
      boxTitle: 'The Sopranos — Complete',
    });
  });

  it('returns null when a loose copy exists', () => {
    expect(soleContainingBoxOf(PARTIAL, ALL)).toBeNull();
    expect(soleContainingBoxOf(LOOSE, ALL)).toBeNull();
  });
});
