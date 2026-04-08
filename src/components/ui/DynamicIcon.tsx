import {
    Activity, Award, Users, Dumbbell, Heart, Star, Zap, Shield,
    Trophy, Target, Clock, Calendar, MapPin, Phone, Mail,
    CheckCircle, ArrowRight, ChevronRight, Play, Pause,
    Camera, Image, Video, Music, Headphones, Mic,
    Home, Building, Briefcase, GraduationCap, BookOpen,
    Flame, Sun, Moon, Wind,
    Smile, ThumbsUp, Gift, Sparkles, Crown, Gem,
    BarChart, TrendingUp, PieChart, LineChart,
    Settings, Wrench, Hammer, Scissors,
    Car, Bike,
    Leaf, Apple, Coffee, Utensils,
    Eye, Layers, Box, Grid,
    Bell, Lock, Unlock, Key,
    Search, Filter, Download, Upload,
    Plus, Minus, X, Check,
    ChevronDown, ChevronUp, ChevronLeft,
    AlertCircle, Info, HelpCircle,
    Globe, Wifi, Bluetooth,
    Battery, Power, Cpu,
    Lightbulb, Rocket, Diamond,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export const iconMap: Record<string, LucideIcon> = {
    Activity, Award, Users, Dumbbell, Heart, Star, Zap, Shield,
    Trophy, Target, Clock, Calendar, MapPin, Phone, Mail,
    CheckCircle, ArrowRight, ChevronRight, Play, Pause,
    Camera, Image, Video, Music, Headphones, Mic,
    Home, Building, Briefcase, GraduationCap, BookOpen,
    Flame, Sun, Moon, Wind,
    Smile, ThumbsUp, Gift, Sparkles, Crown, Gem,
    BarChart, TrendingUp, PieChart, LineChart,
    Settings, Wrench, Hammer, Scissors,
    Car, Bike,
    Leaf, Apple, Coffee, Utensils,
    Eye, Layers, Box, Grid,
    Bell, Lock, Unlock, Key,
    Search, Filter, Download, Upload,
    Plus, Minus, X, Check,
    ChevronDown, ChevronUp, ChevronLeft,
    AlertCircle, Info, HelpCircle,
    Globe, Wifi, Bluetooth,
    Battery, Power, Cpu,
    Lightbulb, Rocket, Diamond,
};

interface DynamicIconProps {
    name: string;
    className?: string;
}

export function DynamicIcon({ name, className }: DynamicIconProps) {
    const Icon = iconMap[name] ?? Activity;
    return <Icon className={className} />;
}
