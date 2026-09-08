export type GtRow = { rowIndex: number; y1Norm: number; y2Norm: number };
export type GtImage = {
  fileName: string;
  imageWidth: number;
  imageHeight: number;
  rotationDeg: number;
  rowCount: number;
  rows: GtRow[];
};

export const ACCEPTED_GT: GtImage[] = [
  { fileName:"IMG_0675(1)", imageWidth:4032, imageHeight:3024, rotationDeg:270, rowCount:6, rows:[
    {rowIndex:1,y1Norm:0.387566,y2Norm:0.449735},{rowIndex:2,y1Norm:0.436508,y2Norm:0.503968},{rowIndex:3,y1Norm:0.498677,y2Norm:0.555556},{rowIndex:4,y1Norm:0.546296,y2Norm:0.600529},{rowIndex:5,y1Norm:0.59127,y2Norm:0.650794},{rowIndex:6,y1Norm:0.648148,y2Norm:0.71164}]},
  { fileName:"IMG_0676(1)", imageWidth:4032, imageHeight:3024, rotationDeg:270, rowCount:6, rows:[
    {rowIndex:1,y1Norm:0.40873,y2Norm:0.455026},{rowIndex:2,y1Norm:0.436508,y2Norm:0.478836},{rowIndex:3,y1Norm:0.46164,y2Norm:0.51455},{rowIndex:4,y1Norm:0.507937,y2Norm:0.537037},{rowIndex:5,y1Norm:0.52381,y2Norm:0.558201},{rowIndex:6,y1Norm:0.559524,y2Norm:0.596561}]},
  { fileName:"IMG_0677(1)", imageWidth:4032, imageHeight:3024, rotationDeg:270, rowCount:5, rows:[
    {rowIndex:1,y1Norm:0.419312,y2Norm:0.47619},{rowIndex:2,y1Norm:0.443122,y2Norm:0.537037},{rowIndex:3,y1Norm:0.531746,y2Norm:0.589947},{rowIndex:4,y1Norm:0.57672,y2Norm:0.634921},{rowIndex:5,y1Norm:0.638889,y2Norm:0.678571}]},
  { fileName:"IMG_0678(1)", imageWidth:4032, imageHeight:3024, rotationDeg:270, rowCount:5, rows:[
    {rowIndex:1,y1Norm:0.421958,y2Norm:0.47619},{rowIndex:2,y1Norm:0.474868,y2Norm:0.518519},{rowIndex:3,y1Norm:0.517196,y2Norm:0.570106},{rowIndex:4,y1Norm:0.571429,y2Norm:0.615079},{rowIndex:5,y1Norm:0.597884,y2Norm:0.669312}]},
  { fileName:"IMG_0679(1)", imageWidth:4032, imageHeight:3024, rotationDeg:270, rowCount:5, rows:[
    {rowIndex:1,y1Norm:0.433862,y2Norm:0.47619},{rowIndex:2,y1Norm:0.464286,y2Norm:0.51455},{rowIndex:3,y1Norm:0.511905,y2Norm:0.555556},{rowIndex:4,y1Norm:0.534392,y2Norm:0.596561},{rowIndex:5,y1Norm:0.582011,y2Norm:0.654762}]},
  { fileName:"IMG_0680(1)", imageWidth:4032, imageHeight:3024, rotationDeg:270, rowCount:2, rows:[
    {rowIndex:1,y1Norm:0.37037,y2Norm:0.460317},{rowIndex:2,y1Norm:0.448413,y2Norm:0.522487}]},
  { fileName:"IMG_0681(1)", imageWidth:4032, imageHeight:3024, rotationDeg:270, rowCount:2, rows:[
    {rowIndex:1,y1Norm:0.462963,y2Norm:0.525132},{rowIndex:2,y1Norm:0.519841,y2Norm:0.572751}]},
  { fileName:"IMG_0682(1)", imageWidth:4032, imageHeight:3024, rotationDeg:180, rowCount:2, rows:[
    {rowIndex:1,y1Norm:0.384921,y2Norm:0.448413},{rowIndex:2,y1Norm:0.443122,y2Norm:0.510582}]},
  { fileName:"IMG_0683(1)", imageWidth:4032, imageHeight:3024, rotationDeg:0, rowCount:2, rows:[
    {rowIndex:1,y1Norm:0.306878,y2Norm:0.383598},{rowIndex:2,y1Norm:0.390212,y2Norm:0.453704}]},
  { fileName:"IMG_0684(1)", imageWidth:4032, imageHeight:3024, rotationDeg:0, rowCount:8, rows:[
    {rowIndex:1,y1Norm:0.195767,y2Norm:0.246032},{rowIndex:2,y1Norm:0.239418,y2Norm:0.276455},{rowIndex:3,y1Norm:0.272487,y2Norm:0.305556},{rowIndex:4,y1Norm:0.293651,y2Norm:0.337302},{rowIndex:5,y1Norm:0.325397,y2Norm:0.365079},{rowIndex:6,y1Norm:0.359788,y2Norm:0.396825},{rowIndex:7,y1Norm:0.60582,y2Norm:0.660053},{rowIndex:8,y1Norm:0.646825,y2Norm:0.699735}]},
  { fileName:"IMG_0685(1)", imageWidth:4032, imageHeight:3024, rotationDeg:0, rowCount:8, rows:[
    {rowIndex:1,y1Norm:0.289683,y2Norm:0.332011},{rowIndex:2,y1Norm:0.318783,y2Norm:0.359788},{rowIndex:3,y1Norm:0.347884,y2Norm:0.384921},{rowIndex:4,y1Norm:0.371693,y2Norm:0.412698},{rowIndex:5,y1Norm:0.403439,y2Norm:0.436508},{rowIndex:6,y1Norm:0.428571,y2Norm:0.473545},{rowIndex:7,y1Norm:0.689153,y2Norm:0.743386},{rowIndex:8,y1Norm:0.730159,y2Norm:0.798942}]},
  { fileName:"IMG_0686(1)", imageWidth:4032, imageHeight:3024, rotationDeg:270, rowCount:3, rows:[
    {rowIndex:1,y1Norm:0.42328,y2Norm:0.519841},{rowIndex:2,y1Norm:0.531746,y2Norm:0.637566},{rowIndex:3,y1Norm:0.686508,y2Norm:0.797619}]},
];

export const GT_MAP = new Map(ACCEPTED_GT.map((x) => [x.fileName, x]));
export const EXPECTED_FILES = ACCEPTED_GT.map((x) => x.fileName);
