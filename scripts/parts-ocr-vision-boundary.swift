// Local, provider-neutral OCR acquisition boundary. No GT, names, prices or file-ID rules.
import Foundation
import Vision
import ImageIO
import Darwin

func pixelBox(_ rect: CGRect, width: Int, height: Int) -> [String: Double] {
    return ["x1":Double(rect.minX)*Double(width), "x2":Double(rect.maxX)*Double(width),
            "y1":(1-Double(rect.maxY))*Double(height), "y2":(1-Double(rect.minY))*Double(height)]
}
func memoryBytes() -> Int64 {
    var usage = rusage()
    getrusage(RUSAGE_SELF, &usage)
    return Int64(usage.ru_maxrss)
}
func recognize(_ file: String) throws -> [String: Any] {
    let url = URL(fileURLWithPath:file)
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil), let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else { throw NSError(domain:"IMAGE_DECODE",code:1) }
    let width=image.width, height=image.height, start=ProcessInfo.processInfo.systemUptime
    let request=VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.recognitionLanguages = ["ja-JP","en-US"]
    request.usesLanguageCorrection = false
    request.customWords = []
    let handler=VNImageRequestHandler(cgImage:image,orientation:.up,options:[:])
    try handler.perform([request])
    var lines:[[String:Any]]=[], tokens:[[String:Any]]=[]
    for (index,observation) in (request.results ?? []).enumerated() {
        guard let text=observation.topCandidates(1).first else { continue }
        let string=text.string
        let lineId="L\(index)"
        var line:[String:Any]=["id":lineId,"text":string,"confidence":Double(text.confidence),"granularity":"line","source":"APPLE_VISION_REV\(request.revision)"]
        line.merge(pixelBox(observation.boundingBox,width:width,height:height)){_,new in new}
        lines.append(line)
        // Provider range boxes, rather than proportional synthetic word boxes.
        let expression=try NSRegularExpression(pattern:"\\S+")
        for (wordIndex,match) in expression.matches(in:string,range:NSRange(string.startIndex...,in:string)).enumerated() {
            guard let range=Range(match.range,in:string), let bounded=try text.boundingBox(for:range) else { continue }
            var characters:[[String:Any]]=[]
            var position=range.lowerBound
            while position<range.upperBound {
                let end=string.index(after:position)
                if let charBox=try text.boundingBox(for:position..<end) {
                    var item:[String:Any]=["text":String(string[position..<end]),"source":"VISION_RANGE_BOX"]
                    item.merge(pixelBox(charBox.boundingBox,width:width,height:height)){_,new in new}
                    characters.append(item)
                }
                position=end
            }
            var token:[String:Any]=["id":"\(lineId)-W\(wordIndex)","text":String(string[range]),"confidence":Double(text.confidence),"lineId":lineId,"granularity":"phrase","source":"APPLE_VISION_REV\(request.revision)","characterBoxes":characters]
            token.merge(pixelBox(bounded.boundingBox,width:width,height:height)){_,new in new}
            tokens.append(token)
        }
    }
    return ["schema":"icb.parts-native-acquisition.v1","engine":"APPLE_VISION","revision":request.revision,
            "width":width,"height":height,"languages":request.recognitionLanguages,"usesLanguageCorrection":false,
            "customWordCount":0,"runtimeGtUsed":false,"tokens":tokens,"lines":lines,
            "recognitionMs":Int((ProcessInfo.processInfo.systemUptime-start)*1000),"peakMemoryBytes":memoryBytes(),
            "os":ProcessInfo.processInfo.operatingSystemVersionString,"coordinateFrame":"TOP_LEFT_PIXELS_EXPLICIT_UP" ]
}
func rectangles(_ file:String) throws -> [String:Any] {
    let url=URL(fileURLWithPath:file)
    guard let source=CGImageSourceCreateWithURL(url as CFURL,nil),let image=CGImageSourceCreateImageAtIndex(source,0,nil) else {throw NSError(domain:"IMAGE_DECODE",code:1)}
    let request=VNDetectRectanglesRequest()
    request.maximumObservations=2
    let start=ProcessInfo.processInfo.systemUptime
    try VNImageRequestHandler(cgImage:image,orientation:.up,options:[:]).perform([request])
    let regions=(request.results ?? []).map { r -> [String:Any] in
        let points=[r.topLeft,r.topRight,r.bottomRight,r.bottomLeft].map {p in ["x":Double(p.x)*Double(image.width),"y":(1-Double(p.y))*Double(image.height)]}
        return ["quad":points,"confidence":Double(r.confidence),"source":"APPLE_VISION_RECTANGLE"]
    }
    return ["schema":"icb.parts-native-geometry.v1","runtimeGtUsed":false,"width":image.width,"height":image.height,"regions":regions,"geometryMs":Int((ProcessInfo.processInfo.systemUptime-start)*1000),"peakMemoryBytes":memoryBytes(),"maximumObservations":2,"usesVendorDefaultGeometryParameters":true]
}
do {
    let args=Array(CommandLine.arguments.dropFirst())
    if args.first=="--capability" {
        let request=VNRecognizeTextRequest(); request.recognitionLevel = .accurate
        let result:[String:Any]=["revision":request.revision,"supportedLanguages":try request.supportedRecognitionLanguages(),"os":ProcessInfo.processInfo.operatingSystemVersionString,"runtimeGtUsed":false]
        FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject:result,options:[.sortedKeys]))
    } else if args.first=="--rectangles" {
        guard args.count==2 else {throw NSError(domain:"USAGE_RECTANGLE_IMAGE",code:2)}
        FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject:try rectangles(args[1]),options:[.sortedKeys]))
    } else if args.first=="--batch" {
        guard args.count==2 else {throw NSError(domain:"USAGE_BATCH_MANIFEST",code:2)}
        let jobs=try JSONSerialization.jsonObject(with:Data(contentsOf:URL(fileURLWithPath:args[1]))) as! [[String:String]]
        var results:[[String:Any]]=[]
        for job in jobs {
            guard let file=job["path"],let id=job["id"] else {throw NSError(domain:"INVALID_ACQUISITION_JOB",code:2)}
            do { var result=try recognize(file);result["id"]=id;results.append(result) }
            catch {results.append(["id":id,"error":String(describing:error),"runtimeGtUsed":false])}
        }
        FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject:results,options:[.sortedKeys]))
    } else {
        guard args.count==1 else {throw NSError(domain:"USAGE_EXPECTS_SINGLE_LOCAL_IMAGE",code:2)}
        FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject:try recognize(args[0]),options:[.sortedKeys]))
    }
} catch {
    let result:[String:Any]=["schema":"icb.parts-native-acquisition.v1","error":String(describing:error),"runtimeGtUsed":false]
    if let data=try? JSONSerialization.data(withJSONObject:result,options:[.sortedKeys]) {FileHandle.standardOutput.write(data)}
    exit(1)
}
