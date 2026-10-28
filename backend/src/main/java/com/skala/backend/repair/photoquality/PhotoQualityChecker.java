package com.skala.backend.repair.photoquality;

import java.io.InputStream;
import java.io.IOException;
import java.util.List;

public interface PhotoQualityChecker {
    String VERSION="java-imageio-luma-laplace-v1";
    record Result(int originalWidth,int originalHeight,int inspectionWidth,int inspectionHeight,
        double meanBrightness,double darkRatio,double brightRatio,double sharpness,List<String> issues) {}
    void validate(InputStream input) throws IOException;
    Result check(InputStream input) throws IOException;
}
