package com.skala.backend.repair.photoquality;

import com.skala.backend.repair.shared.ApiError;

import org.springframework.stereotype.Component;
import javax.imageio.*;
import javax.imageio.stream.ImageInputStream;
import java.awt.*;
import java.awt.image.BufferedImage;
import java.io.*;
import java.util.ArrayList;

@Component
public class JavaPhotoQualityChecker implements PhotoQualityChecker {
    final PhotoQualityProperties policy;
    public JavaPhotoQualityChecker(PhotoQualityProperties policy) {this.policy=policy;}
    private BufferedImage decode(InputStream input) throws IOException {
        // MemoryCache avoids ImageIO's global disk-cache setting and closes its own wrapper.
        try(ImageInputStream imageInput=new javax.imageio.stream.MemoryCacheImageInputStream(input)) {
            var readers=ImageIO.getImageReaders(imageInput);
            if(!readers.hasNext()) throw ApiError.bad("IMAGE_READER_NOT_FOUND");
            var reader=readers.next();
            try {
                var warning=new java.util.concurrent.atomic.AtomicBoolean();
                reader.addIIOReadWarningListener((source,message)->warning.set(true));
                reader.setInput(imageInput,true,true);
                String format=reader.getFormatName();
                if(!format.equalsIgnoreCase("JPEG") && !format.equalsIgnoreCase("PNG")) throw ApiError.bad("UNSUPPORTED_IMAGE_FORMAT");
                int width=reader.getWidth(0),height=reader.getHeight(0);
                if(width<1 || height<1 || width>policy.maxWidth() || height>policy.maxHeight() || (long)width*height>policy.maxDecodePixels()) throw ApiError.bad("IMAGE_DIMENSIONS_LIMIT");
                BufferedImage image=reader.read(0);
                if(image==null) throw ApiError.bad("IMAGE_DECODE_FAILED");
                if(warning.get() || image.getWidth()!=width || image.getHeight()!=height) {image.flush();throw ApiError.bad("IMAGE_DECODE_FAILED");}
                return image;
            } catch(javax.imageio.IIOException|IndexOutOfBoundsException e) {throw ApiError.bad("IMAGE_DECODE_FAILED");}
            finally {reader.dispose();}
        }
    }
    @Override public void validate(InputStream input) throws IOException {var image=decode(input);image.flush();}
    @Override public Result check(InputStream input) throws IOException {
        var original=decode(input);BufferedImage copy=null;
        try {
            int ow=original.getWidth(),oh=original.getHeight();
            double scale=Math.min(1.0,(double)policy.inspectionMaxSize()/Math.max(ow,oh));
            int width=Math.max(1,(int)Math.round(ow*scale)),height=Math.max(1,(int)Math.round(oh*scale));
            // Fixed white background for alpha, with bilinear resize; the original remains untouched.
            copy=new BufferedImage(width,height,BufferedImage.TYPE_INT_RGB);
            var graphics=copy.createGraphics();
            try {graphics.setColor(Color.WHITE);graphics.fillRect(0,0,width,height);graphics.setRenderingHint(RenderingHints.KEY_INTERPOLATION,RenderingHints.VALUE_INTERPOLATION_BILINEAR);graphics.drawImage(original,0,0,width,height,null);}
            finally {graphics.dispose();}
            double[] gray=new double[width*height];double sum=0;long dark=0,bright=0;
            for(int y=0;y<height;y++) for(int x=0;x<width;x++) {
                int rgb=copy.getRGB(x,y);double value=0.299*((rgb>>>16)&255)+0.587*((rgb>>>8)&255)+0.114*(rgb&255);
                gray[y*width+x]=value;sum+=value;
                if(value<=policy.darkPixelThreshold()) dark++;
                if(value>=policy.brightPixelThreshold()) bright++;
            }
            // Exclude outer border: only pixels with all four neighbors contribute. Welford population variance.
            double mean=0,m2=0;long count=0;
            for(int y=1;y<height-1;y++) for(int x=1;x<width-1;x++) {
                int i=y*width+x;double lap=gray[i-width]+gray[i+width]+gray[i-1]+gray[i+1]-4*gray[i];
                count++;double delta=lap-mean;mean+=delta/count;m2+=delta*(lap-mean);
            }
            double sharpness=count==0?0:Math.max(0,m2/count);
            if(!Double.isFinite(sharpness)) throw new IllegalStateException("NON_FINITE_SHARPNESS");
            double darkRatio=(double)dark/gray.length,brightRatio=(double)bright/gray.length;
            var issues=new ArrayList<String>();
            if(Math.min(ow,oh)<Math.min(policy.minWidth(),policy.minHeight()) || Math.max(ow,oh)<Math.max(policy.minWidth(),policy.minHeight())) issues.add("LOW_RESOLUTION");
            if(darkRatio>=policy.darkRatioWarning()) issues.add("TOO_DARK");
            if(brightRatio>=policy.brightRatioWarning()) issues.add("TOO_BRIGHT");
            if(sharpness<policy.sharpnessWarning()) issues.add("BLURRY");
            return new Result(ow,oh,width,height,sum/gray.length,darkRatio,brightRatio,sharpness,java.util.List.copyOf(issues));
        } finally {original.flush();if(copy!=null) copy.flush();}
    }
}
