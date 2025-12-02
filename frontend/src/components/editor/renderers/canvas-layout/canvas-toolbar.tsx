/* Copyright 2024 Marimo. All rights reserved. */

import {
  AlignStartHorizontal,
  AlignStartVertical,
  ArrowDownToLine,
  ArrowRightToLine,
  GitBranch,
  Maximize,
  Rows3,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import React, { memo } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/utils/cn";

export interface CanvasToolbarProps {
  selectedCount: number;
  onLayoutVertical: () => void;
  onLayoutHorizontal: () => void;
  onLayoutByDependencyVertical: () => void;
  onLayoutByDependencyHorizontal: () => void;
  onAlignLeft: () => void;
  onAlignTop: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomToFit: () => void;
}

export const CanvasToolbar: React.FC<CanvasToolbarProps> = memo(
  ({
    selectedCount,
    onLayoutVertical,
    onLayoutHorizontal,
    onLayoutByDependencyVertical,
    onLayoutByDependencyHorizontal,
    onAlignLeft,
    onAlignTop,
    onZoomIn,
    onZoomOut,
    onZoomToFit,
  }) => {
    const hasSelection = selectedCount > 0;
    const hasMultipleSelection = selectedCount > 1;

    return (
      <div className="absolute top-2 left-2 z-50 flex items-center gap-1 bg-background/90 backdrop-blur-sm border rounded-lg p-1 shadow-sm">
        {/* Zoom controls */}
        <div className="flex items-center gap-0.5 pr-2 border-r">
          <Tooltip content="Zoom in">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={onZoomIn}
            >
              <ZoomIn className="h-4 w-4" />
            </Button>
          </Tooltip>
          <Tooltip content="Zoom out">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={onZoomOut}
            >
              <ZoomOut className="h-4 w-4" />
            </Button>
          </Tooltip>
          <Tooltip content="Zoom to fit">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={onZoomToFit}
            >
              <Maximize className="h-4 w-4" />
            </Button>
          </Tooltip>
        </div>

        {/* Layout dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild={true}>
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                "h-8 gap-1.5",
                !hasMultipleSelection && "opacity-50",
              )}
              disabled={!hasMultipleSelection}
            >
              <Rows3 className="h-4 w-4" />
              <span className="text-xs">Layout</span>
              {hasSelection && (
                <span className="text-xs text-muted-foreground ml-1">
                  ({selectedCount})
                </span>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onClick={onLayoutVertical}>
              <ArrowDownToLine className="h-4 w-4 mr-2" />
              Stack Vertically
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onLayoutHorizontal}>
              <ArrowRightToLine className="h-4 w-4 mr-2" />
              Stack Horizontally
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onLayoutByDependencyVertical}>
              <GitBranch className="h-4 w-4 mr-2" />
              By Dependency (Top to Bottom)
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onLayoutByDependencyHorizontal}>
              <GitBranch className="h-4 w-4 mr-2 rotate-90" />
              By Dependency (Left to Right)
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Align dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild={true}>
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                "h-8 gap-1.5",
                !hasMultipleSelection && "opacity-50",
              )}
              disabled={!hasMultipleSelection}
            >
              <AlignStartVertical className="h-4 w-4" />
              <span className="text-xs">Align</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onClick={onAlignLeft}>
              <AlignStartVertical className="h-4 w-4 mr-2" />
              Align Left
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onAlignTop}>
              <AlignStartHorizontal className="h-4 w-4 mr-2" />
              Align Top
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Selection info */}
        {hasSelection && (
          <div className="pl-2 border-l text-xs text-muted-foreground">
            {selectedCount} cell{selectedCount === 1 ? "" : "s"} selected
          </div>
        )}
      </div>
    );
  },
);

CanvasToolbar.displayName = "CanvasToolbar";
